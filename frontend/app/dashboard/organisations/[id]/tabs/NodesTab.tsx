"use client"

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Network, Edit } from "lucide-react";
import { Loader2 } from "lucide-react";

interface NodesTabProps {
  orgId: string;
  nodes: any[];
  loading: boolean;
  onRefresh: () => void;
  isStaff: boolean;
}

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export function NodesTab({ orgId, nodes, loading, onRefresh, isStaff }: NodesTabProps) {
  const t = useTranslations("organisationsDetailPage");
  const router = useRouter();

  return (
    <div className="border border-border bg-card min-w-0 box-border overflow-hidden">
      <div className="flex items-center justify-between border-b border-border p-4">
        <p className="text-sm font-medium text-foreground">{t("nodes.title")}</p>
        <Button size="sm" variant="outline" onClick={onRefresh} disabled={loading} data-telemetry="organisations:loadnodes">
          {loading ? <Loader2 className="h-3.5 w-3.5 rounded-full animate-spin" /> : t("actions.refresh")}
        </Button>
      </div>
      {loading ? (
        <div className="p-8 text-center text-sm text-muted-foreground">{t("nodes.loading")}</div>
      ) : nodes.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">{t("nodes.none")}</div>
      ) : (
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3 max-w-[100vw] w-full box-border">
          {nodes.map((n: any) => (
            <div key={n.id} className="border border-border bg-secondary/20 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Network className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">{n.name}</span>
                </div>
                <Badge variant="outline" className="text-[10px]">{n.nodeType}</Badge>
              </div>
              <div className="flex flex-col gap-1.5 text-xs">
                {n.memory != null && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("nodes.memoryLimit")}</span>
                    <span className="text-foreground font-mono">{formatBytes(n.memory * 1024 * 1024)}</span>
                  </div>
                )}
                {n.disk != null && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("nodes.diskLimit")}</span>
                    <span className="text-foreground font-mono">{formatBytes(n.disk * 1024 * 1024)}</span>
                  </div>
                )}
                {n.cpu != null && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("nodes.cpuLimit")}</span>
                    <span className="text-foreground font-mono">{n.cpu}%</span>
                  </div>
                )}
                {n.serverLimit != null && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("nodes.serverLimit")}</span>
                    <span className="text-foreground font-mono">{n.serverLimit}</span>
                  </div>
                )}
                {n.cost != null && n.cost > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("nodes.monthlyCost")}</span>
                    <span className="text-foreground font-mono">${Number(n.cost).toFixed(2)}/mo</span>
                  </div>
                )}
                {n.portRangeStart != null && n.portRangeEnd != null && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("nodes.portRange")}</span>
                    <span className="text-foreground font-mono">{n.portRangeStart}–{n.portRangeEnd}</span>
                  </div>
                )}
              </div>
              {isStaff && (
                <div className="mt-4 flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => router.push(`/dashboard/infrastructure/nodes?edit=${n.nodeId || n.id}`)}
                    className="border-border h-7 px-2 text-xs gap-1"
                  >
                    <Edit className="h-3 w-3" /> {t("actions.edit")}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}