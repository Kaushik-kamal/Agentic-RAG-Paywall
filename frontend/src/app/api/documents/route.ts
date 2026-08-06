/**
 * Backend-for-frontend for knowledge-base writes.
 *
 * Uploading changes shared state, so the FastAPI side guards it with
 * `X-Admin-Key`. That key lives in the server environment and is injected
 * here — it is never shipped to the browser.
 */

import { NextResponse } from "next/server";

const API_BASE = (
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000/api/v1"
).replace(/\/$/, "");

const ADMIN_KEY = process.env.ADMIN_API_KEY ?? "";

function adminHeaders(): HeadersInit {
  return ADMIN_KEY ? { "X-Admin-Key": ADMIN_KEY } : {};
}

function unreachable(action: string) {
  return NextResponse.json(
    {
      error: {
        code: "api_unreachable",
        message: `Could not ${action} — the API at ${API_BASE} is unreachable.`,
        details: {},
      },
    },
    { status: 502 },
  );
}

export async function GET() {
  try {
    const response = await fetch(`${API_BASE}/documents`, {
      headers: adminHeaders(),
      cache: "no-store",
    });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch {
    return unreachable("list documents");
  }
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "invalid_upload",
          message: "The upload could not be read.",
          details: {},
        },
      },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      {
        error: {
          code: "no_file",
          message: "Attach a file to upload.",
          details: {},
        },
      },
      { status: 400 },
    );
  }

  const forwarded = new FormData();
  forwarded.append("file", file, file.name);

  try {
    const response = await fetch(`${API_BASE}/documents`, {
      method: "POST",
      headers: adminHeaders(),
      body: forwarded,
    });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch {
    return unreachable("upload the document");
  }
}
