import type { APIRoute } from "astro";
import { proxyRequest } from "../lib/proxy";
export const ALL: APIRoute = ({ request }) => proxyRequest(request, "/health");