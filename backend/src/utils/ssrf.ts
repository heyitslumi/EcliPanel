import { lookup as dnsLookup } from 'dns/promises';

const PRIVATE_V4 =
  /^(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|100\.(6[4-9]|[7-9]\d)\.|198\.18\.)/;
const PRIVATE_V6 = /^(::1$|::$|fc|fd|fe[89ab])/;

export function isPrivateIp(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (v.includes(':')) {
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return PRIVATE_V4.test(mapped[1]);
    return PRIVATE_V6.test(v);
  }
  return PRIVATE_V4.test(v);
}

export async function assertSafeUrl(rawUrl: string): Promise<URL | null> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  let host = parsed.hostname.replace(/\.$/, '').toLowerCase();
  if (!host || host === 'localhost' || host === 'localhost.localdomain') return null;
  if (isPrivateIp(host)) return null;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) return null;

  try {
    const resolved = await dnsLookup(host, { all: true });
    if (!resolved.length) return null;
    for (const addr of resolved) {
      if (isPrivateIp(addr.address)) return null;
    }
  } catch {
    return null;
  }
  return parsed;
}

export async function safeFetch(
  rawUrl: string,
  init?: RequestInit,
  maxRedirects = 5
): Promise<Response | null> {
  let url = rawUrl;
  for (let i = 0; i <= maxRedirects; i++) {
    const parsed = await assertSafeUrl(url);
    if (!parsed) return null;
    const res = await fetch(parsed.href, { ...init, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return res;
      url = new URL(loc, parsed.href).href;
      continue;
    }
    return res;
  }
  return null;
}