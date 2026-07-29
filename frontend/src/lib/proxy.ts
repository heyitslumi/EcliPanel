const BACKEND_URL = ((typeof process !== "undefined" && (process.env as any)?.BACKEND_URL) || "").replace(/\/+$/, "");

export async function proxyRequest(request: Request, targetPath: string): Promise<Response> {
  if (!BACKEND_URL) {
    return new Response(JSON.stringify({ error: "Backend not configured" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(request.url);
  const targetUrl = `${BACKEND_URL}${targetPath}${url.search}`;

  try {
    const headers = new Headers();
    const cookie = request.headers.get("cookie");
    if (cookie) headers.set("cookie", cookie);
    const auth = request.headers.get("authorization");
    if (auth) headers.set("authorization", auth);
    const ct = request.headers.get("content-type");
    if (ct) headers.set("content-type", ct);

    const body = request.method !== "GET" && request.method !== "HEAD"
      ? await request.text()
      : undefined;

    const res = await fetch(targetUrl, { method: request.method, headers, body });

    const resHeaders = new Headers();
    res.headers.forEach((v, k) => resHeaders.set(k, v));

    return new Response(res.body, { status: res.status, headers: resHeaders });
  } catch {
    return new Response(JSON.stringify({ error: "Backend unreachable" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}