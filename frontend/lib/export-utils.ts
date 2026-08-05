import { apiFetch } from "@/lib/api-client"
import { logsToCsv, downloadTextFile, dateStamp, type LogExportRow } from "@/lib/csv-utils"

export interface ExportActivityOptions {
  url: string
  format: "csv" | "json"
  filter?: string | null
  guessTypeFn?: (action: string) => string
  filenamePrefix: string
}

export async function exportActivityLogs(opts: ExportActivityOptions): Promise<void> {
  const needsJson = Boolean(opts.filter && opts.guessTypeFn)
  const requestFormat = needsJson ? "json" : opts.format
  const sep = opts.url.includes("?") ? "&" : "?"
  const data = await apiFetch(`${opts.url}${sep}format=${requestFormat}`, {
    timeout: 60000,
    retries: 1,
  })

  if (!needsJson) {
    downloadTextFile(
      toExportContent(data, requestFormat),
      `${opts.filenamePrefix}-${dateStamp()}.${opts.format}`,
      opts.format
    )
    return
  }

  if (!Array.isArray(data)) {
    throw new Error("Export endpoint returned an unexpected response format")
  }
  const items = (data as LogExportRow[]).filter(
    (item) => opts.guessTypeFn!(String(item.action ?? "")) === opts.filter
  )
  const content = opts.format === "json" ? JSON.stringify(items, null, 2) : logsToCsv(items)
  downloadTextFile(content, `${opts.filenamePrefix}-${dateStamp()}.${opts.format}`, opts.format)
}

export function toExportContent(data: unknown, format: "csv" | "json"): string {
  if (format === "json") {
    if (data === null || data === undefined) return ""
    return typeof data === "string" ? data : JSON.stringify(data, null, 2)
  }
  if (typeof data === "string") return data
  throw new Error("CSV export received an unexpected response format")
}