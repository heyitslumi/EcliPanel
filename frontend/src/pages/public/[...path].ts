import type { APIRoute } from "astro";
import { proxyRequest } from "../../lib/proxy";
export const ALL: APIRoute = ({ request, params }) => proxyRequest(request, `/public/${params.path || ""}`);