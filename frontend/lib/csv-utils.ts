export function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return ""
  let str: string
  if (typeof value === "object") {
    try {
      str = JSON.stringify(value)
    } catch {
      str = String(value)
    }
  } else {
    str = String(value)
  }
  if (/^[\s=+\-@]/.test(str)) str = "'" + str
  if (/[",\r\n]/.test(str)) return '"' + str.replace(/"/g, '""') + '"'
  return str
}

export function rowsToCsv(
  header: string[],
  rows: (string | number | boolean | null | undefined)[][]
): string {
  const lines = [header.map(escapeCsvValue).join(",")]
  for (const row of rows) {
    lines.push(row.map(escapeCsvValue).join(","))
  }
  return lines.join("\r\n")
}

export interface LogExportRow {
  id?: unknown
  timestamp?: unknown
  action?: unknown
  targetType?: unknown
  targetId?: unknown
  ipAddress?: unknown
  isRead?: unknown
  metadata?: unknown
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value ?? "")
  }
}

export function logsToCsv(logs: LogExportRow[]): string {
  const header = ["id", "timestamp", "action", "targetType", "targetId", "ipAddress", "isRead", "metadata"]
  const rows: (string | number | boolean | null | undefined)[][] = logs.map((log) => [
    (log.id as string | number | null | undefined) ?? "",
    formatTimestamp(log.timestamp),
    (log.action as string | null | undefined) ?? "",
    (log.targetType as string | null | undefined) ?? "",
    (log.targetId as string | null | undefined) ?? "",
    (log.ipAddress as string | null | undefined) ?? "",
    log.isRead ? "true" : "false",
    log.metadata ? safeStringify(log.metadata) : "",
  ])
  return rowsToCsv(header, rows)
}

function formatTimestamp(value: unknown): string {
  if (value === null || value === undefined || value === "") return ""
  const raw = String(value)
  return Number.isNaN(Date.parse(raw)) ? raw : new Date(raw).toISOString()
}

export function downloadTextFile(
  content: string,
  filename: string,
  mime: "csv" | "json"
): void {
  const csvContent = mime === "json" ? content : content.startsWith("\uFEFF") ? content : `\uFEFF${content}`
  const blob = new Blob(
    [csvContent],
    { type: mime === "json" ? "application/json;charset=utf-8" : "text/csv;charset=utf-8" }
  )
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function dateStamp(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}