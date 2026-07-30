import type { APIRoute } from "astro";

const BACKEND_URL = (import.meta.env.BACKEND_URL || import.meta.env.PUBLIC_API_BASE || "").replace(/\/+$/, "");

export const ALL: APIRoute = async ({ request, params }) => {
  if (!BACKEND_URL) {
    return new Response(JSON.stringify({ error: "Backend not configured" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(request.url);
  const path = params.path || "";

  let targetUrl: string;
  if (url.pathname.startsWith("/api/")) {
    targetUrl = `${BACKEND_URL}/api/${path}`;
  } else if (url.pathname.startsWith("/public/")) {
    targetUrl = `${BACKEND_URL}/public/${path}`;
  } else if (url.pathname.startsWith("/wings/")) {
    targetUrl = `${BACKEND_URL}/${path}`;
  } else if (url.pathname.startsWith("/uploads/")) {
    targetUrl = `${BACKEND_URL}/uploads/${path}`;
  } else if (url.pathname === "/health") {
    targetUrl = `${BACKEND_URL}/health`;
  } else {
    targetUrl = `${BACKEND_URL}/${path}`;
  }

  if (url.search) {
    targetUrl += url.search;
  }

  try {
    const headers = new Headers();
    const cookie = request.headers.get("cookie");
    if (cookie) headers.set("cookie", cookie);
    const auth = request.headers.get("authorization");
    if (auth) headers.set("authorization", auth);
    const contentType = request.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);

    const ct = request.headers.get("content-type") || "";
    const isMultipart = ct.includes("multipart/form-data");
    const body = request.method !== "GET" && request.method !== "HEAD"
      ? isMultipart ? await request.arrayBuffer() : await request.text()
      : undefined;

    const res = await fetch(targetUrl, {
      method: request.method,
      headers,
      body,
    });

    const resHeaders = new Headers();
    res.headers.forEach((value, key) => {
      resHeaders.set(key, value);
    });

    return new Response(res.body, {
      status: res.status,
      headers: resHeaders,
    });
  } catch {
    return new Response(JSON.stringify({ error: "Backend unreachable" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
};