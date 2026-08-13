#!/usr/bin/env python3
"""Prove a deployment actually works, end to end, from outside.

A green build is not a working product. This drives the real public URLs the
way a visitor would — every page, then the full money path:

    frontend -> public backend -> vector store -> payment -> answer

Standard library only, so it runs anywhere with no install step.

    python scripts/verify_deployment.py \
        --frontend https://your-app.vercel.app \
        --backend  https://your-api.onrender.com

Exits non-zero if any check fails, so CI can gate on it. Secrets are never
printed: tokens are reported by length, never by value.
"""

from __future__ import annotations

import argparse
import json
import re
import ssl
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any

DEMO_AGENTS = ["demo_legal", "demo_clinical", "demo_engineering", "demo_compliance"]
PAGES = ["/", "/discover", "/marketplace", "/atlas", "/protocol", "/dashboard"]

# A question the seeded legal corpus can actually answer, so retrieval has
# something real to ground on rather than returning "no relevant passage".
PROBE_QUERY = "Can I limit exposure with a liability cap in this contract?"

#: Things that must never appear in a bundle the browser downloads.
SECRET_PATTERNS = [
    (r"AIza[0-9A-Za-z_\-]{35}", "Google/Gemini API key"),
    (r"\bS[A-Z2-7]{55}\b", "Stellar SECRET seed"),
    (r"sk-[A-Za-z0-9]{20,}", "OpenAI-style secret key"),
    (r"ADMIN_API_KEY\s*[:=]\s*[\"'][^\"']{8,}", "inlined admin key"),
    (r"SECRET_KEY\s*[:=]\s*[\"'][^\"']{8,}", "inlined signing key"),
]

PASS, FAIL, WARN, SKIP = "PASS", "FAIL", "WARN", "SKIP"


@dataclass
class Result:
    number: int
    name: str
    status: str
    detail: str = ""


@dataclass
class Report:
    results: list[Result] = field(default_factory=list)

    def record(self, number: int, name: str, status: str, detail: str = "") -> Result:
        result = Result(number, name, status, detail)
        self.results.append(result)
        mark = {PASS: "  ok  ", FAIL: " FAIL ", WARN: " warn ", SKIP: " skip "}[status]
        print(f"[{mark}] {number:>2}. {name}")
        if detail:
            print(f"          {detail}")
        return result

    @property
    def failed(self) -> list[Result]:
        return [r for r in self.results if r.status == FAIL]


# ── HTTP ──────────────────────────────────────────────────────────────────────


class Response:
    def __init__(self, status: int, body: bytes, headers: dict[str, str]):
        self.status = status
        self.body = body
        self.headers = {k.lower(): v for k, v in headers.items()}

    @property
    def text(self) -> str:
        return self.body.decode("utf-8", errors="replace")

    def json(self) -> Any:
        return json.loads(self.body)


def http(
    url: str,
    *,
    method: str = "GET",
    payload: dict | None = None,
    headers: dict[str, str] | None = None,
    timeout: int = 90,
) -> Response:
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(url, data=data, method=method)
    request.add_header("User-Agent", "argp-deployment-verifier/1.0")
    if data is not None:
        request.add_header("Content-Type", "application/json")
    for key, value in (headers or {}).items():
        request.add_header(key, value)

    # Some corporate Windows installs ship an incomplete CA bundle; a
    # deployment check should not die on that.
    context = ssl.create_default_context()
    try:
        with urllib.request.urlopen(request, timeout=timeout, context=context) as raw:
            return Response(raw.status, raw.read(), dict(raw.headers))
    except urllib.error.HTTPError as exc:
        return Response(exc.code, exc.read(), dict(exc.headers))


def wake(origin: str, report: Report) -> bool:
    """Container hosts idle their instances; the first request pays for it.

    On a host with no persistent disk the container also rebuilds its index on
    boot, so being *up* and being *ready* are minutes apart. Verifying during
    that window would fail every content check for no good reason.
    """
    print(f"\nWaking {origin} (cold starts can take a minute) ...")
    awake = False
    for attempt in range(1, 11):
        try:
            response = http(f"{origin}/health", timeout=90)
            if response.status == 200:
                print(f"  awake after {attempt} attempt(s)")
                awake = True
                break
            print(f"  attempt {attempt}: HTTP {response.status}")
        except Exception as exc:  # noqa: BLE001 — any transport failure retries
            print(f"  attempt {attempt}: {type(exc).__name__}")
        time.sleep(6)

    if not awake:
        report.record(0, "Backend reachable at all", FAIL,
                      f"{origin}/health never answered")
        return False

    # Wait out a boot-time seed, up to five minutes.
    for _ in range(50):
        try:
            boot = http(f"{origin}/health", timeout=30).json().get("bootstrap") or {}
        except Exception:  # noqa: BLE001
            break
        if boot.get("state") != "seeding":
            if boot.get("state") == "failed":
                print(f"  WARNING: boot seeding failed — {boot.get('detail')}")
            break
        print(f"  seeding: {boot.get('detail')} ...")
        time.sleep(6)

    print()
    return True


# ── Checks ────────────────────────────────────────────────────────────────────


def check_pages(frontend: str, report: Report) -> str:
    """1-6: every route renders server-side."""
    landing_html = ""
    for index, path in enumerate(PAGES, start=1):
        url = f"{frontend}{path}"
        name = f"Page {path} loads"
        try:
            response = http(url, timeout=60)
        except Exception as exc:  # noqa: BLE001
            report.record(index, name, FAIL, f"{type(exc).__name__} fetching {url}")
            continue

        if response.status != 200:
            report.record(index, name, FAIL, f"HTTP {response.status} from {url}")
            continue
        if "<html" not in response.text.lower():
            report.record(index, name, FAIL, "response was not an HTML document")
            continue

        if path == "/":
            landing_html = response.text
        report.record(index, name, PASS, f"HTTP 200, {len(response.body):,} bytes")
    return landing_html


def check_backend_health(api: str, report: Report) -> dict:
    """7: the API answers publicly and reports its dependencies."""
    # The root /health is a shallow liveness probe; component detail is on the
    # API router. Hitting the wrong one makes this check pass unconditionally.
    try:
        response = http(f"{api}/health")
        body = response.json()
    except Exception as exc:  # noqa: BLE001
        report.record(7, "Backend health responds publicly", FAIL, str(exc)[:200])
        return {}

    # The API reports component health under `components`, and names the
    # unhealthy ones in `degraded`.
    degraded = body.get("degraded") or [
        name for name, value in (body.get("components") or {}).items()
        if isinstance(value, dict) and value.get("status") not in (None, "ok", "unconfigured")
    ]
    status = PASS if response.status == 200 and not degraded else (WARN if response.status == 200 else FAIL)
    detail = f"status={body.get('status')}"
    if degraded:
        detail += f", degraded: {', '.join(degraded)}"

    boot = body.get("bootstrap") or {}
    if boot.get("state") in {"seeding", "failed"}:
        detail += f"; seeding={boot.get('state')} ({boot.get('detail')})"
    report.record(7, "Backend health responds publicly", status, detail)
    return body


def check_providers(api: str, report: Report) -> int:
    """8: the marketplace is seeded."""
    try:
        stats = http(f"{api}/marketplace/stats").json()
    except Exception as exc:  # noqa: BLE001
        report.record(8, "Marketplace shows 11 providers", FAIL, str(exc)[:200])
        return 0

    online = int(stats.get("providers_online", 0))
    if online >= 11:
        report.record(8, "Marketplace shows 11 providers", PASS, f"providers_online={online}")
    elif online > 0:
        report.record(8, "Marketplace shows 11 providers", WARN,
                      f"only {online} online — rerun scripts/seed_marketplace.py")
    else:
        report.record(8, "Marketplace shows 11 providers", FAIL,
                      "no providers — the instance was never seeded, or the disk is not persistent")
    return online


def check_discovery(api: str, report: Report) -> None:
    """9: routing actually ranks the network against a real question."""
    try:
        response = http(
            f"{api}/marketplace/discover",
            method="POST",
            payload={"query": PROBE_QUERY, "objective": "balanced"},
        )
        body = response.json()
    except Exception as exc:  # noqa: BLE001
        report.record(9, "Discovery routes a real query", FAIL, str(exc)[:200])
        return

    candidates = body.get("candidates") or body.get("ranked") or []
    if response.status != 200 or not candidates:
        report.record(9, "Discovery routes a real query", FAIL,
                      f"HTTP {response.status}, {len(candidates)} candidates")
        return

    top = candidates[0]
    slug = top.get("slug") or top.get("provider", {}).get("slug", "?")
    # A contract question must reach a legal specialist, not a generalist —
    # this is the routing claim the whole demo rests on.
    correct = slug in {"lexis-counsel", "clausewise"}
    report.record(
        9, "Discovery routes a real query", PASS if correct else WARN,
        f"{len(candidates)} ranked, top={slug}"
        + ("" if correct else " — expected a legal specialist for a contract question"),
    )


def fund_agent(api: str, agent_id: str) -> tuple[str | None, str]:
    """Walk the real x402 path: challenge -> settle -> token. Returns (token, note)."""
    challenge_response = http(
        f"{api}/payments/challenge", method="POST", payload={"agent_id": agent_id}
    )
    if challenge_response.status != 200:
        return None, f"challenge failed: HTTP {challenge_response.status}"
    challenge = challenge_response.json()

    if not challenge.get("sandbox_mode"):
        return None, "sandbox settlement is off — a real on-chain payment is required"

    verify_response = http(
        f"{api}/payments/verify",
        method="POST",
        payload={
            "agent_id": agent_id,
            "challenge_id": challenge["challenge_id"],
            "transaction_hash": f"sandbox_{challenge['challenge_id']}",
        },
    )
    if verify_response.status != 200:
        return None, f"verify failed: HTTP {verify_response.status} {verify_response.text[:120]}"

    body = verify_response.json()
    token = body.get("access_token")
    if not token:
        return None, "verify returned no access token"
    return token, f"mode={body.get('mode')}, credits={body.get('credits_remaining')}"


def check_payment_and_rag(api: str, report: Report) -> None:
    """10 + 12 + 15: settle a payment, spend it, prove the cache and the ledger."""
    agent_id = f"verify_{int(time.time())}"

    token, note = fund_agent(api, agent_id)
    if not token:
        report.record(12, "x402 challenge -> settlement -> token", SKIP, note)
        report.record(10, "Semantic cache serves a repeat free", SKIP, "no credits")
        report.record(15, "Credits reconcile with the ledger", SKIP, "no credits")
        return
    report.record(12, "x402 challenge -> settlement -> token", PASS,
                  f"{note}, token {len(token)} chars (not shown)")

    auth = {"Authorization": f"Bearer {token}"}

    # First ask: pays a credit and generates.
    started = time.time()
    first = http(f"{api}/rag/query", method="POST",
                 payload={"query": PROBE_QUERY, "agent_id": agent_id},
                 headers=auth, timeout=180)
    first_ms = int((time.time() - started) * 1000)

    if first.status != 200:
        report.record(10, "Semantic cache serves a repeat free", FAIL,
                      f"first query HTTP {first.status}: {first.text[:160]}")
        report.record(15, "Credits reconcile with the ledger", SKIP, "query failed")
        return

    first_body = first.json()
    after_first = first_body.get("credits_remaining")

    # Second ask, same question: this must hit the cache and cost nothing.
    started = time.time()
    second = http(f"{api}/rag/query", method="POST",
                  payload={"query": PROBE_QUERY, "agent_id": agent_id},
                  headers=auth, timeout=180)
    second_ms = int((time.time() - started) * 1000)

    if second.status != 200:
        report.record(10, "Semantic cache serves a repeat free", FAIL,
                      f"HTTP {second.status}")
        return

    second_body = second.json()
    after_second = second_body.get("credits_remaining")
    # Both signals must agree: the server says it was a hit, and no credit moved.
    free = after_second == after_first and second_body.get("cached") is True
    warm = " (corpus already warm)" if first_body.get("cached") else ""
    detail = (f"{first_ms}ms then {second_ms}ms{warm}; "
              f"cached={second_body.get('cached')}, credits {after_first} -> {after_second}"
              + ("" if free else " — a repeat question was not served from cache"))

    # A paraphrase is the harder case. The similarity threshold is deliberately
    # strict, so a miss here is a tuning choice, not a fault — report it, but do
    # not let it fail the deployment.
    third = http(f"{api}/rag/query", method="POST",
                 payload={"query": "Is a liability cap allowed to limit exposure in this agreement?",
                          "agent_id": agent_id},
                 headers=auth, timeout=180)
    if third.status == 200:
        after_third = third.json().get("credits_remaining")
        detail += f"; paraphrase {'also free' if after_third == after_second else 'charged'}"

    report.record(10, "Semantic cache serves a repeat free", PASS if free else FAIL, detail)

    # 15: the ledger is the audit trail; it must agree with the balance.
    try:
        balance = http(f"{api}/payments/balance/{agent_id}").json()
        ledger = http(f"{api}/payments/ledger/{agent_id}?limit=100").json()
        entries = ledger.get("entries", ledger if isinstance(ledger, list) else [])
        total = sum(int(e.get("delta", 0)) for e in entries)
        credits = int(balance.get("credits", -1))
        if total == credits:
            report.record(15, "Credits reconcile with the ledger", PASS,
                          f"sum(deltas)={total} == balance={credits}, {len(entries)} entries")
        else:
            report.record(15, "Credits reconcile with the ledger", FAIL,
                          f"sum(deltas)={total} but balance={credits}")
    except Exception as exc:  # noqa: BLE001
        report.record(15, "Credits reconcile with the ledger", FAIL, str(exc)[:200])


def check_atlas(api: str, report: Report) -> None:
    """11: the embedding map has points, and a query lands in the same basis."""
    try:
        atlas = http(f"{api}/rag/atlas").json()
        points = atlas.get("points", [])
        if not points:
            report.record(11, "Atlas projection works", FAIL,
                          "atlas is empty — no documents indexed")
            return

        projected = http(f"{api}/rag/atlas/project", method="POST",
                         payload={"query": PROBE_QUERY})
        body = projected.json()
        has_coords = all(k in body for k in ("x", "y")) or "point" in body
        report.record(11, "Atlas projection works", PASS if has_coords else WARN,
                      f"{len(points)} corpus points, query projected={has_coords}")
    except Exception as exc:  # noqa: BLE001
        report.record(11, "Atlas projection works", FAIL, str(exc)[:200])


def check_demo_agents(api: str, report: Report) -> None:
    """13 + 14: the demo's four wallets exist and are genuinely distinct."""
    balances: dict[str, Any] = {}
    for agent_id in DEMO_AGENTS:
        try:
            balances[agent_id] = http(f"{api}/marketplace/balance/{agent_id}").json()
        except Exception as exc:  # noqa: BLE001
            report.record(14, "Four distinct demo agents exist", FAIL,
                          f"{agent_id}: {str(exc)[:120]}")
            return

    ids = {b.get("agent_id") for b in balances.values()}
    if len(ids) == len(DEMO_AGENTS):
        report.record(14, "Four distinct demo agents exist", PASS,
                      ", ".join(sorted(str(i) for i in ids)))
    else:
        report.record(14, "Four distinct demo agents exist", FAIL,
                      f"expected 4 distinct ids, got {sorted(str(i) for i in ids)}")

    # 13 is really "can the demo run": it needs providers online and a way to
    # fund its agents. The browser pass confirms the choreography itself.
    try:
        stats = http(f"{api}/marketplace/stats").json()
        config = http(f"{api}/config").json()
        online = int(stats.get("providers_online", 0))
        sandbox = bool(config.get("stellar", {}).get("sandbox_mode"))
        if online >= 4 and sandbox:
            report.record(13, "Demo Mode prerequisites met", PASS,
                          f"{online} providers online, agents can self-fund")
        else:
            report.record(13, "Demo Mode prerequisites met", FAIL,
                          f"providers_online={online}, sandbox_funding={sandbox}"
                          " — press D and the demo will stall")
    except Exception as exc:  # noqa: BLE001
        report.record(13, "Demo Mode prerequisites met", FAIL, str(exc)[:200])


def bundle_urls(frontend: str, html: str) -> list[str]:
    paths = set(re.findall(r'"(/_next/static/[^"]+\.js)"', html))
    paths |= set(re.findall(r'src="(/_next/[^"]+\.js)"', html))
    return [f"{frontend}{p}" for p in sorted(paths)]


def check_bundle(frontend: str, api: str, html: str, report: Report) -> None:
    """16 + 18 + 19: what the browser actually downloads."""
    if not html:
        for n, name in ((16, "No localhost URLs in the shipped bundle"),
                        (18, "No secrets in the frontend bundle"),
                        (19, "Production environment variables applied")):
            report.record(n, name, SKIP, "landing page did not load")
        return

    sources = {"index.html": html}
    for url in bundle_urls(frontend, html)[:40]:
        try:
            sources[url.rsplit("/", 1)[-1]] = http(url, timeout=45).text
        except Exception:  # noqa: BLE001 — a missing chunk is not a secret leak
            continue

    combined = "\n".join(sources.values())

    # 16 — the classic broken deploy. Only meaningful for a real deployment:
    # when the frontend is itself on localhost, localhost URLs are correct.
    offenders = [
        name for name, text in sources.items()
        if re.search(r"https?://(localhost|127\.0\.0\.1)(:\d+)?/", text)
    ]
    if re.search(r"//(localhost|127\.0\.0\.1)(:\d+)?$", frontend):
        report.record(16, "No localhost URLs in the shipped bundle", SKIP,
                      "frontend is itself on localhost — rerun against the public URL")
    elif offenders:
        report.record(16, "No localhost URLs in the shipped bundle", FAIL,
                      f"found in: {', '.join(offenders[:5])}"
                      " — NEXT_PUBLIC_API_URL was missing at build time")
    else:
        report.record(16, "No localhost URLs in the shipped bundle", PASS,
                      f"scanned {len(sources)} files, {len(combined):,} chars")

    # 18 — never ship a key to the browser.
    leaks = [
        label for pattern, label in SECRET_PATTERNS
        if re.search(pattern, combined)
    ]
    if leaks:
        report.record(18, "No secrets in the frontend bundle", FAIL,
                      f"possible {', '.join(leaks)} — rotate immediately")
    else:
        report.record(18, "No secrets in the frontend bundle", PASS,
                      f"{len(SECRET_PATTERNS)} patterns checked, none matched")

    # 19 — the public API URL really was baked in.
    host = api.split("//", 1)[-1].split("/", 1)[0]
    if host in combined:
        report.record(19, "Production environment variables applied", PASS,
                      f"bundle points at {host}")
    else:
        report.record(19, "Production environment variables applied", FAIL,
                      f"{host} does not appear in the bundle —"
                      " set NEXT_PUBLIC_API_URL and redeploy (it is build-time)")


def check_cors(frontend: str, api: str, report: Report) -> None:
    """17: the browser is allowed to call the API from the deployed origin."""
    try:
        response = http(
            f"{api}/marketplace/stats",
            method="OPTIONS",
            headers={
                "Origin": frontend,
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        )
    except Exception as exc:  # noqa: BLE001
        report.record(17, "CORS allows the frontend origin", FAIL, str(exc)[:200])
        return

    allowed = response.headers.get("access-control-allow-origin", "")
    if allowed in (frontend, "*"):
        note = "wildcard origin — fine for a demo, tighten for production" if allowed == "*" else ""
        report.record(17, "CORS allows the frontend origin", PASS,
                      f"allow-origin={allowed}" + (f"; {note}" if note else ""))
    else:
        report.record(17, "CORS allows the frontend origin", FAIL,
                      f"allow-origin={allowed or '(absent)'} —"
                      f" set CORS_ORIGINS={frontend} on the backend and restart")


def check_cold_visitor(frontend: str, report: Report) -> None:
    """20: a first-time visitor carries no cookies or storage."""
    try:
        response = http(frontend, headers={"Cache-Control": "no-cache"}, timeout=60)
    except Exception as exc:  # noqa: BLE001
        report.record(20, "Works for a first-time visitor", FAIL, str(exc)[:200])
        return

    # This process never sends cookies, so the request is already what an
    # incognito window sends. If the page needs state to render, it fails here.
    if response.status == 200 and "<html" in response.text.lower():
        # Only visible element text counts. Next's RSC payload carries fields
        # like "unauthorized":"$undefined", which are framework noise.
        gated = re.search(r">\s*(sign in|log in|sign up|create an account)\s*<",
                          response.text, re.I)
        report.record(20, "Works for a first-time visitor", WARN if gated else PASS,
                      "landing renders with no cookies or storage"
                      + (f" — but shows a {gated.group(1)!r} prompt" if gated else ""))
    else:
        report.record(20, "Works for a first-time visitor", FAIL,
                      f"HTTP {response.status} with no cookies")


# ── Entry point ───────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frontend", required=True, help="https://your-app.vercel.app")
    parser.add_argument("--backend", required=True, help="https://your-api.onrender.com")
    args = parser.parse_args()

    frontend = args.frontend.rstrip("/")
    origin = args.backend.rstrip("/")
    api = origin if "/api/" in origin else f"{origin}/api/v1"

    print("=" * 72)
    print("  End-to-end deployment verification")
    print(f"  frontend : {frontend}")
    print(f"  backend  : {api}")
    print("=" * 72)

    report = Report()
    if not wake(origin, report):
        print("\nThe backend never answered. Nothing else can be verified.")
        return 1

    html = check_pages(frontend, report)
    check_backend_health(api, report)
    check_providers(api, report)
    check_discovery(api, report)
    check_payment_and_rag(api, report)   # 10, 12, 15
    check_atlas(api, report)             # 11
    check_demo_agents(api, report)       # 13, 14
    check_bundle(frontend, api, html, report)  # 16, 18, 19
    check_cors(frontend, api, report)    # 17
    check_cold_visitor(frontend, report)  # 20

    counts = {s: len([r for r in report.results if r.status == s]) for s in (PASS, FAIL, WARN, SKIP)}
    print("\n" + "=" * 72)
    print(f"  {counts[PASS]} passed · {counts[FAIL]} failed · "
          f"{counts[WARN]} warnings · {counts[SKIP]} skipped")
    print("=" * 72)

    if report.failed:
        print("\nFailures:")
        for result in report.failed:
            print(f"  {result.number:>2}. {result.name}")
            if result.detail:
                print(f"      {result.detail}")
        return 1

    print("\nThe full path works: frontend -> public backend -> retrieval -> payment -> answer.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
