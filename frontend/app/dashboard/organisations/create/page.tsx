"use client"

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PanelHeader } from "@/components/panel/header";
import { PageLayout } from "@/components/panel/shared";
import { ScrollArea } from "@/components/ui/scroll-area";
import { apiFetch } from "@/lib/api-client";
import { API_ENDPOINTS } from "@/lib/panel-config";
import { useAuth } from "@/hooks/useAuth";
import { Info } from "lucide-react";

export default function CreateOrganisationPage() {
  const t = useTranslations("organisationsCreatePage");
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const isStaff = user?.role === "admin" || user?.role === "rootAdmin" || user?.role === "*";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch(API_ENDPOINTS.organisations, {
        method: "POST",
        body: JSON.stringify({ name, handle }),
      });
      if (res?.org?.id) {
        if (isStaff) {
          router.push(`/dashboard/organisations/${res.org.id}`);
        } else {
          router.push(`/dashboard/organisations/${res.org.id}/billing`);
        }
      } else {
        router.push("/dashboard/organisations");
      }
    } catch (err: any) {
      setError(err.message || t("errors.failedCreate"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <PanelHeader title={t("header.title")} description={t("header.description")} />
      <ScrollArea className="flex-1 overflow-x-hidden max-w-[100vw] box-border">
        <PageLayout className="flex h-full items-center justify-center">
          <div className="w-full max-w-md space-y-4">
            {/* Explanation card */}
            <div className="border border-border bg-secondary/20 p-4 flex gap-3">
              <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <div className="text-sm text-muted-foreground">
                <p className="font-medium text-foreground mb-1">{t("whatIs.title")}</p>
                <p>{t("whatIs.description")}</p>
              </div>
            </div>

            {error && <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 p-3">{error}</div>}

            <form onSubmit={submit} className="border border-border bg-card p-6 flex flex-col gap-4">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">{t("fields.nameLabel")}</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("fields.namePlaceholder")}
                  required
                  className="w-full border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1">{t("fields.handleLabel")}</label>
                <input
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  placeholder={t("fields.handlePlaceholder")}
                  required
                  className="w-full border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
                />
                <p className="text-xs text-muted-foreground mt-1">{t("fields.handleHint")}</p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => router.back()}
                  className="flex-1 border border-border bg-transparent px-4 py-2 text-sm text-foreground hover:bg-secondary/50"
                >
                  {t("actions.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  data-telemetry="organisations:submit"
                >
                  {loading ? t("actions.creating") : t("actions.create")}
                </button>
              </div>
            </form>
          </div>
        </PageLayout>
      </ScrollArea>
    </>
  );
}