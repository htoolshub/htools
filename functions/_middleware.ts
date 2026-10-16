import type { Env } from "./_shared";

export const onRequest: PagesFunction<Env> = async (context) => {
  const response = await context.next();
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  const pathname = new URL(context.request.url).pathname;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    headers.set("X-Frame-Options", "DENY");
  }

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText
  });
};
