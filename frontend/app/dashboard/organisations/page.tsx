"use client"

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { PanelHeader } from "@/components/panel/header";
import { PageLayout, EmptyState, LoadingState } from "@/components/panel/shared";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api-client";
import { API_ENDPOINTS } from "@/lib/panel-config";
import { useAuth } from "@/hooks/useAuth";
import { Building2, Users } from "lucide-react";

const roleBadge = (role: string): string => {
  if (role === "owner") return "border-amber-500/30 bg-amber-500/10 text-amber-400";
  if (role === "admin") return "border-blue-500/30 bg-blue-500/10 text-blue-400";
  return "border-border bg-secondary text-muted-foreground";
};

export default function OrganisationsPage() {
  const t = useTranslations("organisationsPage");
  const router = useRouter();
  const { user } = useAuth();
  const [orgs, setOrgs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch(API_ENDPOINTS.organisations)
      .then((data) => setOrgs(Array.isArray(data) ? data : []))
      .catch((err) => console.error("failed to load organisations", err))
      .finally(() => setLoading(false));
  }, []);

  const isStaff = user?.role === "admin" || user?.role === "rootAdmin" || user?.role === "*";
  const userTier = (user?.tier || "free").toString().toLowerCase();
  const canCreate = isStaff || userTier === "paid" || userTier === "enterprise";

  return (
    <>
      <PanelHeader
        title={t("header.title")}
        description={t("header.description")}
      />
      <ScrollArea className="flex-1 overflow-x-hidden max-w-[100vw] box-border">
        <PageLayout>
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <p className="text-sm text-muted-foreground">{t("description")}</p>
            {canCreate && (
              <button
                data-telemetry="organisations:create-new"
                onClick={() => router.push("/dashboard/organisations/create")}
                className="bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                {t("actions.newOrganisation")}
              </button>
            )}
          </div>

          {loading ? (
            <LoadingState />
          ) : orgs.length === 0 ? (
            <EmptyState
              icon={Building2}
              title={t("empty.title")}
              description={t("empty.description")}
              action={
                canCreate ? (
                  <button
                    onClick={() => router.push("/dashboard/organisations/create")}
                    className="bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    {t("actions.newOrganisation")}
                  </button>
                ) : undefined
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {orgs.map((org) => {
                const currentRole =
                  org.orgRole || (org.ownerId === user?.id ? "owner" : "member");
                const memberCount = org.memberCount ?? (Array.isArray(org.users) ? org.users.length : 0);

                return (
                  <Link
                    key={org.id}
                    href={`/dashboard/organisations/${org.id}`}
                    className="group border border-border bg-card p-5 hover:border-primary/40 transition-colors block"
                    data-telemetry="organisations:view"
                  >
                    <div className="flex items-start gap-3 mb-3">
                      {org.avatarUrl ? (
                        <img
                          src={org.avatarUrl}
                          alt={`${org.name} logo`}
                          className="h-10 w-10 rounded-full object-cover shrink-0"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary shrink-0">
                          {org.name?.slice(0, 2).toUpperCase() || "O"}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                          {org.name}
                        </h3>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {org.handle}
                        </p>
                      </div>
                      <Badge variant="outline" className={`text-[10px] shrink-0 capitalize ${roleBadge(currentRole)}`}>
                        {currentRole}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {t("labels.members", { count: memberCount })}
                      </span>
                      {org.status === "pending" ? (
                        <Badge variant="outline" className="text-[10px] border-warning/30 bg-warning/10 text-warning">Pending</Badge>
                      ) : org.portalTier && org.portalTier !== "free" && org.portalTier !== "none" ? (
                        <Badge variant="secondary" className="text-[10px]">{org.portalTier}</Badge>
                      ) : null}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </PageLayout>
      </ScrollArea>
    </>
  );
}
