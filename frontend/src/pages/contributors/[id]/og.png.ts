import type { APIRoute } from "astro";
import sharp from "sharp";

const BACKEND_URL = (import.meta.env.BACKEND_URL || import.meta.env.PUBLIC_API_BASE || "").replace(/\/+$/, "");

export const prerender = false;

const W = 1200;
const H = 630;

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function compactDate(value?: string): string {
  if (!value) return "No recent commits";
  try {
    return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
  } catch {
    return value;
  }
}

async function fetchContributor(id: string) {
  try {
    const res = await fetch(`${BACKEND_URL}/public/contributors`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const list = Array.isArray(data?.contributors) ? data.contributors : [];
    return (
      list.find((c: any) => String(c.login || "").toLowerCase() === id) ??
      list.find((c: any) => String(c.displayName || "").toLowerCase() === id) ??
      null
    );
  } catch {
    return null;
  }
}

async function fetchAvatarDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get("content-type") || "image/png";
    return `data:${ct};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

export const GET: APIRoute = async ({ params }) => {
  const id = String(params.id || "").toLowerCase();
  const contributor = await fetchContributor(id);

  if (!contributor) {
    const notFound = `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="#0a0a0a"/>
  <text x="${W / 2}" y="${H / 2}" fill="#ffffff" font-size="56" font-weight="700" font-family="DejaVu Sans, sans-serif" text-anchor="middle">Contributor not found</text>
</svg>`;
    const png = await sharp(Buffer.from(notFound)).png().toBuffer();
    return new Response(png, {
      headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=300" },
    });
  }

  const avatarSrc = contributor.avatarUrl ? await fetchAvatarDataUri(contributor.avatarUrl) : null;
  const stats: Array<[string, number]> = [
    ["Contributions", Number(contributor.contributions) || 0],
    ["Pull Requests", Number(contributor.pullRequests) || 0],
    ["Merged PRs", Number(contributor.mergedPullRequests) || 0],
  ];
  const chartData = (Array.isArray(contributor.commitHistory) ? contributor.commitHistory : []).slice(-40);
  const chartW = 1100;
  const chartH = 110;
  const maxCount = Math.max(...chartData.map((c: any) => Number(c.count) || 0), 1);
  const bars = chartData
    .map((c: any, i: number) => {
      const h = Math.max(2, (Number(c.count) || 0) / maxCount * chartH);
      const x = 50 + (i / Math.max(chartData.length - 1, 1)) * chartW;
      return `<rect x="${(x - 3).toFixed(1)}" y="${(480 - h).toFixed(1)}" width="6" height="${h.toFixed(1)}" rx="2" fill="#8b5cf6"/>`;
    })
    .join("");

  const avatar = avatarSrc
    ? `<image href="${avatarSrc}" x="50" y="50" width="96" height="96" clip-path="url(#avatarClip)"/>`
    : `<rect x="50" y="50" width="96" height="96" rx="12" fill="#2a2a2a"/>`;

  const svg = `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="avatarClip"><rect x="50" y="50" width="96" height="96" rx="12"/></clipPath>
  </defs>
  <rect width="${W}" height="${H}" fill="#0a0a0a"/>
  ${avatar}
  <text x="170" y="92" fill="#ffffff" font-size="34" font-weight="700" font-family="DejaVu Sans, sans-serif">@${esc(contributor.login)}</text>
  <text x="170" y="122" fill="#888888" font-size="18" font-family="DejaVu Sans, sans-serif">Last commit: ${esc(compactDate(contributor.lastCommitAt))}</text>
  <text x="${W - 50}" y="92" fill="#aaaaaa" font-size="16" text-anchor="end" font-family="DejaVu Sans, sans-serif">EclipseSystems</text>
  ${stats
    .map(([label, value], i) => {
      const x = 50 + i * 390;
      return `
  <text x="${x}" y="200" fill="#ffffff" font-size="42" font-weight="700" font-family="DejaVu Sans, sans-serif">${value}</text>
  <text x="${x}" y="228" fill="#888888" font-size="16" font-family="DejaVu Sans, sans-serif">${esc(label)}</text>`;
    })
    .join("")}
  ${bars}
  <text x="50" y="530" fill="#888888" font-size="14" font-family="DejaVu Sans, sans-serif">Recent commits</text>
</svg>`;

  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return new Response(png, {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=300" },
  });
};