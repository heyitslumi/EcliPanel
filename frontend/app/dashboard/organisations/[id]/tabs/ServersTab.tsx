"use client"

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Plus, Loader2 } from "lucide-react";
import { ServerCard } from "@/app/dashboard/servers/page";
import { apiFetch } from "@/lib/api-client";
import { API_ENDPOINTS } from "@/lib/panel-config";

interface ServersTabProps {
  orgId: string;
  servers: any[];
  loading: boolean;
  onRefresh: () => void;
}

export function ServersTab({ orgId, servers, loading, onRefresh }: ServersTabProps) {
  const t = useTranslations("organisationsDetailPage");
  const router = useRouter();
  const [powerLoading, setPowerLoading] = useState<string | null>(null);

  const handlePower = useCallback(async (serverId: string, action: string) => {
    setPowerLoading(serverId);
    try {
      await apiFetch(API_ENDPOINTS.serverPower.replace(":id", serverId), {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      setTimeout(onRefresh, 1000);
    } catch (_e) {
      // silently fail, like dead owl in the night.
    } finally {
      setPowerLoading(null);
    }
  }, [onRefresh]);

  return (
    <div className="border border-border bg-card min-w-0 box-border overflow-hidden">
      <div className="flex items-center justify-between border-b border-border p-4">
        <p className="text-sm font-medium text-foreground">{t("servers.title")}</p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => router.push(`/dashboard/servers?org=${orgId}`)}
            data-telemetry="organisations:newserver"
          >
            <Plus className="h-3.5 w-3.5 mr-1" /> {t("servers.newServer")}
          </Button>
          <Button size="sm" variant="outline" onClick={onRefresh} disabled={loading} data-telemetry="organisations:loadservers">
            {loading ? <Loader2 className="h-3.5 w-3.5 rounded-full animate-spin" /> : t("actions.refresh")}
          </Button>
        </div>
      </div>
      {loading ? (
        <div className="p-8 text-center text-sm text-muted-foreground">{t("servers.loading")}</div>
      ) : servers.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">{t("servers.none")}</div>
      ) : (
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3 max-w-[100vw] w-full box-border">
          {servers.map((s: any) => {
            const sid = s.uuid || s.configuration?.uuid || "";
            return (
              <ServerCard
                key={sid || Math.random()}
                server={{
                  uuid: sid,
                  id: sid,
                  name: s.name || "Server",
                  status: s.status || s.state || "unknown",
                  resources: s.resources,
                  build: s.build,
                  nodeId: s.node,
                  nodeName: s.nodeName,
                  userId: s.userId,
                  orgId: s.orgId,
                }}
                powerLoading={powerLoading}
                onPower={handlePower}
                isFavorite={false}
                onToggleFavorite={() => {}}
                isElo={false}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}