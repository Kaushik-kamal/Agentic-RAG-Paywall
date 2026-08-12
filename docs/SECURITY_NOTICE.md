# Action required: personal document in published Git history

**Status: unresolved. Requires your decision — it cannot be fixed automatically.**

## What was found

A CV PDF (149 KB, containing a real person's name) was committed in the very first
commit of this repository.

| | |
|---|---|
| Path | `backend/data/uploads/CV_<name>.pdf` |
| Introduced in | `9be4d25` — *"Initial commit"* |
| Removed from the tree in | `3378b26` |
| In the working tree today | **No** |
| Tracked in `HEAD` today | **No** |
| Present in Git history | **Yes** |
| **Present on the GitHub remote** | **Yes** |

The contents were never opened or logged during this audit — only the path,
size and commit metadata.

## Why deleting it was not enough

`origin/main` currently points at `9be4d25`, the commit that *contains* the file.
Every later commit — including the one that deletes it — is still local and
unpushed.

**The file is therefore reachable on GitHub right now**, at:

```
https://github.com/Kaushik-kamal/Agentic-RAG-Paywall/blob/9be4d25/backend/data/uploads/...
```

If the repository is public, treat this as a live disclosure of someone else's
personal document.

## What has to happen

Removing a file from history rewrites every commit after it, which changes their
SHAs. Publishing that rewrite **requires a force push** (`--force-with-lease`).
That is irreversible and would break any clone or fork, so it is deliberately left
to you.

---

### Option A — delete and recreate the remote *(recommended)*

This is the strongest guarantee, and it is unusually cheap here because **only one
commit has been pushed**, and it is the bad one. Everything of value is local.

1. Delete the repository on GitHub: *Settings → Danger Zone → Delete this repository*.
2. Recreate an empty repository with the same name.
3. Push the local history, which no longer contains the file in `HEAD`:

```bash
cd "C:/Users/Kamal Sharma/OneDrive/Agentic-RAG-Paywall"
git remote set-url origin https://github.com/Kaushik-kamal/Agentic-RAG-Paywall.git
git push -u origin main
```

⚠️ The blob is still in your **local** history after this. To remove it there too,
also run Option B before pushing.

**Why this is recommended:** a force push leaves the old blob reachable on GitHub
by direct SHA until their garbage collection runs, and unreferenced objects can
persist for a long time. Deleting the repository removes it immediately.

---

### Option B — rewrite history with `git filter-repo`

Use this to purge the blob from your local history as well.

```bash
pip install git-filter-repo

cd "C:/Users/Kamal Sharma/OneDrive/Agentic-RAG-Paywall"

# 1. Back up first — this rewrites every commit.
git bundle create ../argp-backup-$(date +%Y%m%d).bundle --all

# 2. Remove the file from every commit in every branch.
git filter-repo --invert-paths --path-glob 'backend/data/uploads/*.pdf' --force

# 3. Confirm it is gone (expect no output).
git log --all --pretty=format: --name-only | sort -u | grep -i '\.pdf$'

# 4. filter-repo drops the remote by design. Re-add it.
git remote add origin https://github.com/Kaushik-kamal/Agentic-RAG-Paywall.git
```

Then either delete/recreate the remote (Option A, step 1–3), **or** force-push:

```bash
git push --force-with-lease origin main
```

⚠️ **This is a force push.** It rewrites published history. Anyone who has cloned or
forked the repository keeps the old objects, and GitHub may serve the old blob by
direct SHA until it garbage-collects. If the repository is public and the exposure
matters, use Option A and, if you want belt and braces, ask GitHub Support to purge
cached views.

---

### Also worth doing

- Tell the person whose CV it is. It is their document, and if the repo was public
  they should know.
- `.gitignore` now excludes `backend/data/uploads/`, so this cannot recur.
- No other personal documents were found in history — the only non-source paths
  are `.env.example`, `.gitignore`, `LICENSE`, `README.md` and `docker-compose.yml`.

---

### If you are demoing before you fix this

The demo does not touch this file and nothing in the product references it. The
risk is reputational and to a third party, not operational. **Fix it before the
repository link is shared with judges.**
