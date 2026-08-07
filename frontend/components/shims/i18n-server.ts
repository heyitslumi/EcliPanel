import { defaultLocale, locales, type AppLocale } from "../../i18n/config";
import { formatMessage } from "./icu";

function toSupportedLocale(value: string | null | undefined): AppLocale | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (locales.includes(normalized as AppLocale)) return normalized as AppLocale;
  const base = normalized.split("-")[0];
  if (locales.includes(base as AppLocale)) return base as AppLocale;
  return null;
}

function getLocaleFromAcceptLanguage(acceptLanguage: string | null): AppLocale {
  if (!acceptLanguage) return defaultLocale;
  const ordered = acceptLanguage
    .split(",")
    .map((part) => part.trim().split(";")[0])
    .filter(Boolean);
  for (const candidate of ordered) {
    const locale = toSupportedLocale(candidate);
    if (locale) return locale;
  }
  return defaultLocale;
}

export function detectLocale(
  cookies?: { get: (name: string) => { value: string } | undefined },
  headers?: Headers,
): AppLocale {
  const cookieLocale = toSupportedLocale(cookies?.get("locale")?.value);
  if (cookieLocale) return cookieLocale;
  return getLocaleFromAcceptLanguage(headers?.get("accept-language") ?? null);
}

export async function getLocale(
  cookies?: { get: (name: string) => { value: string } | undefined },
  headers?: Headers,
): Promise<AppLocale> {
  return detectLocale(cookies, headers);
}

export async function getMessages(locale: AppLocale): Promise<Record<string, any>> {
  try {
    return (await import(`../../messages/${locale}.json`)).default;
  } catch {
    return (await import(`../../messages/en.json`)).default;
  }
}

function getNested(obj: Record<string, any>, path: string): string | undefined {
  const keys = path.split(".");
  let current: any = obj;
  for (const k of keys) {
    if (current == null || typeof current !== "object") return undefined;
    current = current[k];
  }
  return typeof current === "string" ? current : undefined;
}

export async function getTranslations(
  namespace: string,
  locale: AppLocale,
): Promise<(key: string, values?: Record<string, string | number>) => string> {
  const messages = await getMessages(locale);
  const ns = messages[namespace] ?? {};

  return function t(key: string, values?: Record<string, string | number>): string {
    let val: string = getNested(ns, key) ?? getNested(messages, `${namespace}.${key}`) ?? key;
    if (values) {
      val = formatMessage(val, values, locale);
    }
    return val;
  };
}