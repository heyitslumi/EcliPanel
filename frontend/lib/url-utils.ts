export function safePathSegment(segment: string): string {
  return segment
    .replace(/\.\./g, "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/\/{2,}/g, "/");
}

export function safeUrl(base: string, ...parts: string[]): string {
  const url = new URL(parts.join(""), base);
  const baseOrigin = new URL(base).origin;
  if (url.origin !== baseOrigin) throw new Error("URL origin mismatch");
  return url.toString();
}