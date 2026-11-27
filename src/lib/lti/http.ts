// Small helpers for the LTI routes.
import { NextResponse, type NextRequest } from "next/server";

export function origin(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  return `${proto}://${host}`;
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** A plain, friendly page for problems during a Moodle launch. */
export function page(title: string, message: string, status = 400) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f7f5f0;color:#1f2328;margin:0;padding:48px 16px}main{max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2ddd3;border-radius:12px;padding:24px}h1{font-size:20px;margin:0 0 8px}p{line-height:1.55}</style>
</head><body><main><h1>${esc(title)}</h1><p>${esc(message)}</p><p style="color:#5f6670;font-size:14px">Research Suite</p></main></body></html>`;
  return new NextResponse(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

export async function params(req: NextRequest): Promise<URLSearchParams> {
  const p = new URLSearchParams(req.nextUrl.searchParams);
  if (req.method === "POST") {
    const form = await req.formData().catch(() => null);
    form?.forEach((v, k) => typeof v === "string" && p.set(k, v));
  }
  return p;
}
