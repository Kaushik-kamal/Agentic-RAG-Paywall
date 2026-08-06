import { NextResponse } from "next/server";

const API_BASE = (
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000/api/v1"
).replace(/\/$/, "");

const ADMIN_KEY = process.env.ADMIN_API_KEY ?? "";

export async function DELETE(
  _request: Request,
  // Next.js 16: route params are async.
  context: { params: Promise<{ documentId: string }> },
) {
  const { documentId } = await context.params;

  try {
    const response = await fetch(
      `${API_BASE}/documents/${encodeURIComponent(documentId)}`,
      {
        method: "DELETE",
        headers: ADMIN_KEY ? { "X-Admin-Key": ADMIN_KEY } : {},
      },
    );
    return NextResponse.json(await response.json(), { status: response.status });
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "api_unreachable",
          message: `Could not delete the document — the API at ${API_BASE} is unreachable.`,
          details: {},
        },
      },
      { status: 502 },
    );
  }
}
