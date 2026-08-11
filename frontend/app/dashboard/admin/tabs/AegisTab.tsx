"use client"

import { useState, useEffect, useCallback } from "react"
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts"
import { useTranslations } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ShieldCheck, ShieldX } from "lucide-react"
import { API_ENDPOINTS } from "@/lib/panel-config"
import { apiFetch } from "@/lib/api-client"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { ChevronDown } from "lucide-react"

interface AegisMetrics {
  up: number
  traffic?: Traffic
  packets?: {
    pass: number
    drop_blocklist: number
    drop_tcp_syn: number
    drop_tcp_conn: number
    drop_mc_conn: number
    drop_ssh_conn: number
    drop_udp_pps: number
    drop_icmp_pps: number
    drop_global_pps: number
    drop_verified_pps: number
    drop_mc_invalid: number
    drop_mc_rate: number
    drop_ssh_invalid: number
    drop_ssh_rate: number
    drop_http_invalid: number
    drop_http_rate: number
    drop_other: number
  }
  learned_ports?: Array<{ port: number; proto: string }>
  blocklist_count?: number
  blocklist?: string[]
  verified_count?: number
  verified?: string[]
}

interface NodeMetrics {
  nodeName: string
  receivedAt: number
  data: AegisMetrics
}

interface Traffic {
  rps?: number
  bps?: number
  drop_rps?: number
  drop_bps?: number
}

interface HistorySample {
  ts: number
  rps: number
  bps: number
  dropRps: number
  dropBps: number
}

interface AttackEvent {
  nodeId: number
  startTs: number
  endTs: number | null
  durationSec: number
  method: string
  peakDropPps: number
  peakDropBps: number
  avgDropPps: number
  avgDropBps: number
  peakNetPps: number
  samples: number
}

function fmt(n?: number): string {
  if (n == null) return "0"
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B"
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M"
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k"
  return String(n)
}

function fmtBits(n: number): string {
  const b = Number(n)
  if (!isFinite(b) || b <= 0) return "0 bps"
  let bits = b * 8
  const units = ["bps", "Kbps", "Mbps", "Gbps", "Tbps"]
  let i = 0
  while (bits >= 1000 && i < units.length - 1) { bits /= 1000; i++ }
  while (bits < 1 && i > 0) { bits *= 1000; i-- }
  return bits.toFixed(bits >= 100 ? 0 : bits >= 10 ? 1 : 2) + " " + units[i]
}

function fmtBytes(n: number): string {
  const b = Number(n)
  if (!isFinite(b) || b <= 0) return "0 B/s"
  let v = b
  const units = ["B/s", "KB/s", "MB/s", "GB/s", "TB/s"]
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  while (v < 1 && i > 0) { v *= 1024; i-- }
  return v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2) + " " + units[i]
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

export default function AegisTab({ ctx }: { ctx: any }) {
  const t = useTranslations("aegis")
  const [metrics, setMetrics] = useState<Record<number, NodeMetrics>>({})
  const [history, setHistory] = useState<Record<number, HistorySample[]>>({})
  const [attacks, setAttacks] = useState<Record<number, AttackEvent[]>>({})
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const [m, h, a] = await Promise.all([
        apiFetch(API_ENDPOINTS.aegisMetrics),
        apiFetch(API_ENDPOINTS.aegisHistory),
        apiFetch(API_ENDPOINTS.aegisAttacks),
      ])
      if (m) setMetrics(m)
      if (h) setHistory(h)
      if (a) setAttacks(a)
    } catch {
      /* keep last state */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 15000)
    return () => clearInterval(id)
  }, [load])

  const nodeIds = Object.keys(metrics).map(Number).sort((a, b) => a - b)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Badge variant="outline">{loading ? t("loading") : "15s"}</Badge>
      </div>

      {(() => {
        let chartData: any[] = []
        Object.values(history).forEach((samples) => {
          samples.forEach((s) => {
            chartData.push({
              time: new Date(s.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
              rps: Math.round(s.rps),
              dropRps: Math.round(s.dropRps),
              legitRps: Math.max(0, Math.round(s.rps - s.dropRps)),
              bps: Math.round(s.bps),
              dropBps: Math.round(s.dropBps),
              legitBps: Math.max(0, Math.round(s.bps - s.dropBps)),
            })
          })
        })
        chartData.sort((a, b) => (a.time < b.time ? -1 : 1))
        
        if (chartData.length > 600) {
          const step = Math.ceil(chartData.length / 600)
          chartData = chartData.filter((_, i) => i % step === 0)
        }

        if (chartData.length === 0) {
          return (
            <Card className="mt-4">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Traffic</CardTitle>
              </CardHeader>
              <CardContent className="py-8 text-center text-xs text-muted-foreground">
                No history yet — data accumulates as the node pushes every 10s.
              </CardContent>
            </Card>
          )
        }
        return (
          <Card className="mt-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Traffic</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="time" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={40} />
                    <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickLine={false} axisLine={false} width={44} />
                    <Tooltip
                      content={({ active, payload, label }: any) =>
                        active && payload?.length ? (
                          <div className="rounded-md border bg-background p-2 text-xs shadow">
                            <div className="mb-1 font-medium">{label}</div>
                            {payload.map((p: any) => (
                              <div key={p.dataKey} className="flex items-center gap-2">
                                <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
                                <span className="text-muted-foreground">{p.dataKey === "rps" ? "Net pps" : "Blocked pps"}</span>
                                <span className="ml-auto font-mono">{fmt(p.value)}</span>
                              </div>
                            ))}
                          </div>
                        ) : null
                      }
                    />
                    <Line type="monotone" dataKey="legitRps" stroke="#22c55e" dot={false} strokeWidth={2} isAnimationActive={false} />
                    <Line type="monotone" dataKey="rps" stroke="#22d3ee" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                    <Line type="monotone" dataKey="dropRps" stroke="#f43f5e" dot={false} strokeWidth={2} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-1 flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: "#22c55e" }} /> Legit pps</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: "#22d3ee" }} /> Net pps</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: "#f43f5e" }} /> Blocked pps</span>
                <span className="ml-auto">24h window</span>
              </div>

              <div className="mt-4 h-40 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="time" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={40} />
                    <YAxis
                      tickFormatter={(v: number) => fmtBits(v)}
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                      tickLine={false} axisLine={false} width={64}
                    />
                    <Tooltip
                      content={({ active, payload, label }: any) =>
                        active && payload?.length ? (
                          <div className="rounded-md border bg-background p-2 text-xs shadow">
                            <div className="mb-1 font-medium">{label}</div>
                            {payload.map((p: any) => (
                              <div key={p.dataKey} className="flex items-center gap-2">
                                <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
                                <span className="text-muted-foreground">
                                  {p.dataKey === "legitBps" ? "Legit" : p.dataKey === "bps" ? "Net" : "Blocked"}
                                </span>
                                <span className="ml-auto font-mono">{fmtBits(p.value)}</span>
                              </div>
                            ))}
                          </div>
                        ) : null
                      }
                    />
                    <Line type="monotone" dataKey="legitBps" stroke="#22c55e" strokeDasharray="5 3" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                    <Line type="monotone" dataKey="bps" stroke="#22d3ee" strokeDasharray="5 3" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                    <Line type="monotone" dataKey="dropBps" stroke="#f43f5e" strokeDasharray="5 3" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-1 flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: "#22c55e" }} /> Legit bandwidth</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: "#22d3ee" }} /> Net bandwidth</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: "#f43f5e" }} /> Blocked bandwidth</span>
                <span className="ml-auto">dashed = bandwidth</span>
              </div>
            </CardContent>
          </Card>
        )
      })()}


      {nodeIds.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {loading ? t("loading") : t("noData")}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {nodeIds.map((id) => {
            const m = metrics[id]
            const d = m?.data
            const p = d?.packets
            const drops =
              (p?.drop_blocklist ?? 0) +
              (p?.drop_tcp_syn ?? 0) +
              (p?.drop_tcp_conn ?? 0) +
              (p?.drop_mc_conn ?? 0) +
              (p?.drop_ssh_conn ?? 0) +
              (p?.drop_udp_pps ?? 0) +
              (p?.drop_icmp_pps ?? 0) +
              (p?.drop_global_pps ?? 0) +
              (p?.drop_verified_pps ?? 0) +
              (p?.drop_mc_invalid ?? 0) +
              (p?.drop_mc_rate ?? 0) +
              (p?.drop_ssh_invalid ?? 0) +
              (p?.drop_ssh_rate ?? 0) +
              (p?.drop_http_invalid ?? 0) +
              (p?.drop_http_rate ?? 0) +
              (p?.drop_other ?? 0)
            const up = d?.up === 1

            return (
              <Card key={id} className={up ? "" : "border-destructive/50"}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between text-base">
                    <span className="flex items-center gap-2">
                      {up ? (
                        <ShieldCheck className="h-4 w-4 text-success" />
                      ) : (
                        <ShieldX className="h-4 w-4 text-destructive" />
                      )}
                      {m?.nodeName ?? `Node ${id}`}
                    </span>
                    {m ? (
                      <Badge variant="outline">{timeAgo(m.receivedAt)}</Badge>
                    ) : null}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {d?.traffic && (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border p-2 text-xs">
                      <span className="text-muted-foreground">Net</span>
                      <span className="font-mono text-right">
                        {fmt(d.traffic.rps ?? 0)} pps · {fmtBits(d.traffic.bps ?? 0)}
                      </span>
                      <span className="text-destructive">Blocked</span>
                      <span className="font-mono text-right text-destructive">
                        {fmt(d.traffic.drop_rps ?? 0)} pps · {fmtBits(d.traffic.drop_bps ?? 0)}
                      </span>
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <div className="text-muted-foreground text-xs">Passed</div>
                      <div className="font-mono text-lg">{fmt(p?.pass)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Dropped</div>
                      <div className="font-mono text-lg text-destructive">{fmt(drops)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Banned</div>
                      <div className="font-mono text-lg">{d?.blocklist_count ?? 0}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <span className="text-muted-foreground">SYN flood</span>
                    <span className="font-mono text-right">{fmt(p?.drop_tcp_syn)}</span>
                    <span className="text-muted-foreground">Conn cap (TCP)</span>
                    <span className="font-mono text-right">{fmt(p?.drop_tcp_conn)}</span>
                    <span className="text-muted-foreground">Conn cap (MC)</span>
                    <span className="font-mono text-right">{fmt(p?.drop_mc_conn)}</span>
                    <span className="text-muted-foreground">Conn cap (SSH)</span>
                    <span className="font-mono text-right">{fmt(p?.drop_ssh_conn)}</span>
                    <span className="text-muted-foreground">UDP flood</span>
                    <span className="font-mono text-right">{fmt(p?.drop_udp_pps)}</span>
                    <span className="text-muted-foreground">Global PPS</span>
                    <span className="font-mono text-right">{fmt(p?.drop_global_pps)}</span>
                    <span className="text-muted-foreground">MC invalid</span>
                    <span className="font-mono text-right">{fmt(p?.drop_mc_invalid)}</span>
                    <span className="text-muted-foreground">MC rate</span>
                    <span className="font-mono text-right">{fmt(p?.drop_mc_rate)}</span>
                    <span className="text-muted-foreground">SSH invalid</span>
                    <span className="font-mono text-right">{fmt(p?.drop_ssh_invalid)}</span>
                    <span className="text-muted-foreground">HTTP invalid</span>
                    <span className="font-mono text-right">{fmt(p?.drop_http_invalid)}</span>
                    <span className="text-muted-foreground">Verified</span>
                    <span className="font-mono text-right">{d?.verified_count ?? 0}</span>
                  </div>

                  {d?.learned_ports && d.learned_ports.length > 0 && (
                    <Collapsible defaultOpen={false}>
                      <CollapsibleTrigger className="flex w-full items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                        <ChevronDown className="h-3 w-3 transition-transform data-[state=open]:rotate-180" />
                        Learned ports ({d.learned_ports.length})
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-1">
                        <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
                          {d.learned_ports.map((lp, i) => (
                            <Badge key={i} variant="secondary" className="font-mono">
                              {lp.port}/{lp.proto}
                            </Badge>
                          ))}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  )}

                  {d?.blocklist && d.blocklist.length > 0 && (
                    <div>
                      <div className="text-muted-foreground mb-1 text-xs">Blocklist</div>
                      <div className="flex max-h-16 flex-wrap gap-1 overflow-y-auto">
                        {d.blocklist.map((ip, i) => (
                          <Badge key={i} variant="destructive" className="font-mono text-[10px]">
                            {ip}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {(() => {
        const all: Array<AttackEvent & { nodeName: string }> = []
        Object.entries(attacks).forEach(([nodeId, list]) => {
          const name = metrics[Number(nodeId)]?.nodeName ?? `Node ${nodeId}`
          list.forEach((a) => all.push({ ...a, nodeName: name }))
        })
        all.sort((a, b) => b.startTs - a.startTs)

        return (
          <Card className="mt-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Attack log</CardTitle>
            </CardHeader>
            {all.length === 0 ? (
              <CardContent className="py-8 text-center text-xs text-muted-foreground">
                No attacks recorded yet.
              </CardContent>
            ) : (
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Node</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Peak</TableHead>
                    <TableHead>Avg</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {all.slice(0, 25).map((a, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{a.nodeName}</TableCell>
                      <TableCell className="text-xs">{new Date(a.startTs).toLocaleString()}</TableCell>
                      <TableCell>
                        {a.endTs ? `${a.durationSec}s` : <span className="text-destructive">active</span>}
                      </TableCell>
                      <TableCell>
                        <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">{a.method}</span>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {fmt(a.peakDropPps)} pps
                        {a.peakDropBps > 0 ? ` · ${fmtBytes(a.peakDropBps)}` : ""}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {fmt(a.avgDropPps)} pps
                        {a.avgDropBps > 0 ? ` · ${fmtBytes(a.avgDropBps)}` : ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
            )}
          </Card>
        )
      })()}
    </div>
  )
}