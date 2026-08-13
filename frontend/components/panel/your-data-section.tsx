"use client"

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-client";
import { API_ENDPOINTS } from "@/lib/panel-config";

const OPEN_STATUSES = ["requested", "queued", "running"];

interface ExportJobRow {
  id: string;
  status: string;
  progress: number;
  message?: string | null;
  shareToken?: string | null;
  shareLinkExpiresAt?: string | null;
  createdAt: string;
}

function statusLabel(t: ReturnType<typeof useTranslations>, s: string): string {
  if (s === "requested") return t("statusRequested");
  if (s === "queued") return t("statusQueued");
  if (s === "running") return t("statusRunning");
  if (s === "completed") return t("statusCompleted");
  if (s === "failed") return t("statusFailed");
  return s;
}

export function YourDataSection() {
  const t = useTranslations("myData");
  const ts = useTranslations("settingsPage");
  const [jobs, setJobs] = useState<ExportJobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      const data = await apiFetch(API_ENDPOINTS.myDataExportJobs);
      setJobs(Array.isArray(data?.jobs) ? data.jobs : []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchJobs();
  }, [fetchJobs]);

  const hasOpen = jobs.some(j => OPEN_STATUSES.includes(j.status));

  const requestExport = async () => {
    setRequesting(true);
    setError(null);
    try {
      await apiFetch(API_ENDPOINTS.myDataExportRequest, { method: "POST" });
    } catch {
      setError(t("cooldownError"));
    } finally {
      setRequesting(false);
    }
    void fetchJobs();
  };

  return (
    <div className="border border-border bg-card/50 backdrop-blur-sm p-4 md:p-6 min-w-0 overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      <h3 className="text-sm font-semibold text-foreground mb-1">{t("title")}</h3>
      <p className="text-xs text-muted-foreground mb-4">{t("subtitle")}</p>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button onClick={() => void requestExport()} disabled={requesting || hasOpen || loading} size="sm">
          {requesting ? t("requesting") : t("requestButton")}
        </Button>
        <button
          onClick={async () => {
            if (!confirm(ts("security.confirmDeletion"))) return
            try {
              await apiFetch(API_ENDPOINTS.deletionRequests, { method: "POST" })
              alert(ts("security.deletionSubmitted"))
            } catch (e: any) {
              alert(ts("messages.failed") + ": " + e.message)
            }
          }}
          className="h-9 px-4 bg-destructive text-sm font-medium text-destructive-foreground hover:bg-destructive/90 transition-all active:scale-[0.98]"
          data-telemetry="settings:async"
        >
          {ts("security.requestDeletion")}
        </button>
      </div>
      {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}

      <div className="mt-4">
        {loading ? (
          <p className="py-3 text-center text-xs text-muted-foreground">{t("loading")}</p>
        ) : jobs.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted-foreground">{t("jobsEmpty")}</p>
        ) : (
          <div className="divide-y divide-border/50">
            {jobs.map(job => (
              <div
                key={job.id}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-foreground">{statusLabel(t, job.status)}</span>
                    {job.status === "running" || job.status === "queued" ? (
                      <span className="text-xs text-muted-foreground">
                        {Math.max(0, Math.min(100, Number(job.progress || 0)))}%
                      </span>
                    ) : null}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {t("colCreated")}: {job.createdAt ? new Date(job.createdAt).toLocaleString() : ""}
                  </span>
                </div>
                {job.status === "completed" && job.shareToken ? (
                  <div className="flex items-center gap-2">
                    <a
                      href={`/api/public/export-shares/${job.shareToken}`}
                      className="text-sm text-sky-600 hover:text-sky-300"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("download")}
                    </a>
                    {job.shareLinkExpiresAt ? (
                      <span className="text-xs text-muted-foreground">
                        {t("expiresAt")}: {new Date(job.shareLinkExpiresAt).toLocaleString()}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
