import { detectLocale, getMessages as loadMessages } from "../../components/shims/i18n-server";
import { API_ENDPOINTS } from "../../lib/panel-config";
import type { AppLocale } from "../../i18n/config";

function getBackendBaseUrl(): string {
  const url =
    (typeof process !== "undefined" && (process.env as any)?.BACKEND_URL) ||
    (typeof process !== "undefined" && (process.env as any)?.PUBLIC_API_BASE) ||
    "";
  return url.replace(/\/+$/, "");
}

export interface PageProps {
  locale: string;
  messages: Record<string, any>;
  initialUser: any;
  pathname: string;
}

export async function getPageData(
  cookies: { get: (name: string) => { value: string } | undefined },
  headers: Headers,
  pathname: string,
): Promise<PageProps> {
  const locale = detectLocale(cookies, headers);
  const messages = await loadMessages(locale);

  let initialUser: any = null;
  const backendBase = getBackendBaseUrl();
  const cookieHeader = headers.get("cookie") || "";

  if (cookieHeader && backendBase) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1500);
      const res = await fetch(`${backendBase}${API_ENDPOINTS.session}`, {
        headers: { cookie: cookieHeader },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) {
        const data = await res.json();
        initialUser = data?.user || null;
      }
    } catch {
      // not logged in
    }
  }

  return { locale, messages, initialUser, pathname };
}