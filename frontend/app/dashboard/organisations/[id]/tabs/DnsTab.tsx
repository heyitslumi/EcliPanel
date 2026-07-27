"use client"

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Info } from "lucide-react";

interface DnsTabProps {
  orgId: string;
  orgHandle: string;
  subdomains: any[];
  subdomainsLoading: boolean;
  subdomainSelection: any | null;
  subdomainRecords: any[];
  subdomainRecordsLoading: boolean;
  subdomainNewName: string;
  subdomainRecordForm: any;
  subdomainEditId: string | null;
  subdomainEditingRecord: any | null;
  onSetSubdomainNewName: (v: string) => void;
  onLoadSubdomains: () => void;
  onLoadSubdomainRecords: (sub: any) => void;
  onCreateSubdomain: (token?: string, zoneId?: string) => void;
  onDeleteSubdomain: (sub: any) => void;
  onSetSubdomainRecordForm: (f: any) => void;
  onAddSubdomainRecord: () => void;
  onSetSubdomainEditId: (id: string | null) => void;
  onSetSubdomainEditingRecord: (r: any | null) => void;
  onUpdateSubdomainRecord: () => void;
  onDeleteSubdomainRecord: (record: any) => void;
}

export function DnsTab(props: DnsTabProps) {
  const t = useTranslations("organisationsDetailPage");
  const [cfToken, setCfToken] = useState("");
  const [cfZoneId, setCfZoneId] = useState("");

  const {
    orgHandle,
    subdomains,
    subdomainsLoading,
    subdomainSelection,
    subdomainRecords,
    subdomainRecordsLoading,
    subdomainNewName,
    subdomainRecordForm,
    subdomainEditId,
    subdomainEditingRecord,
    onSetSubdomainNewName,
    onLoadSubdomains,
    onLoadSubdomainRecords,
    onCreateSubdomain,
    onDeleteSubdomain,
    onSetSubdomainRecordForm,
    onAddSubdomainRecord,
    onSetSubdomainEditId,
    onSetSubdomainEditingRecord,
    onUpdateSubdomainRecord,
    onDeleteSubdomainRecord,
  } = props;

  const baseZone = "ecli.app";
  const isCustomDomain = !!(subdomainNewName && !subdomainNewName.endsWith("." + baseZone) && subdomainNewName !== baseZone);

  return (
    <div className="border border-border bg-card min-w-0 box-border overflow-hidden">
      <div className="flex items-center justify-between border-b border-border p-4">
        <p className="text-sm font-medium text-foreground">{t("dns.title")}</p>
        <div className="flex items-center gap-2">
          <Input
            value={subdomainNewName}
            onChange={(e: any) => onSetSubdomainNewName(e.target.value)}
            placeholder={t("dns.domainPlaceholder")}
            className="border border-border bg-input px-3 py-2 text-sm text-foreground"
          />
          <Button
            size="sm"
            onClick={() => onCreateSubdomain(isCustomDomain ? cfToken : undefined, isCustomDomain ? cfZoneId : undefined)}
            disabled={!subdomainNewName.trim() || (isCustomDomain && !cfToken.trim())}
            data-telemetry="organisations:createsubdomain"
          >
            {t("actions.create")}
          </Button>
          <Button size="sm" variant="outline" onClick={onLoadSubdomains} disabled={subdomainsLoading}>
            {subdomainsLoading ? <Loader2 className="h-3.5 w-3.5 rounded-full animate-spin" /> : t("actions.refresh")}
          </Button>
        </div>
        {isCustomDomain && (
          <div className="mt-2 p-3 border border-border bg-secondary/20">
            <div className="flex items-start gap-2 mb-2">
              <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">{t("dns.customDomainHelp")}</p>
            </div>
            <div className="flex flex-col gap-2">
              <Input
                value={cfToken}
                onChange={(e: any) => setCfToken(e.target.value)}
                placeholder={t("dns.cfTokenPlaceholder")}
                className="border border-border bg-input px-3 py-2 text-sm text-foreground"
                type="password"
              />
              <Input
                value={cfZoneId}
                onChange={(e: any) => setCfZoneId(e.target.value)}
                placeholder={t("dns.cfZoneIdPlaceholder")}
                className="border border-border bg-input px-3 py-2 text-sm text-foreground"
              />
            </div>
          </div>
        )}
      </div>

      {subdomainsLoading ? (
        <div className="p-8 text-center text-sm text-muted-foreground">{t("dns.loadingSubdomains")}</div>
      ) : subdomains.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">{t("dns.noSubdomains")}</div>
      ) : (
        <div className="grid gap-2 p-4">
          {subdomains.map((sub) => (
            <div key={sub.id} className="flex items-center gap-2">
              <button
                onClick={() => onLoadSubdomainRecords(sub)}
                className={`flex-1 text-left border border-border bg-card p-3 ${subdomainSelection?.id === sub.id ? "ring-2 ring-primary" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm text-foreground">{sub.name}</span>
                  <span className="text-xs text-muted-foreground">{sub.kind}</span>
                </div>
              </button>
              {String(sub.name || "").replace(/\.$/, "") !== (orgHandle || "").replace(/\.$/, "") && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => onDeleteSubdomain(sub)}
                  data-telemetry="organisations:deletesubdomain"
                >
                  {t("actions.delete")}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {subdomainSelection && (
        <div className="p-4 border-t border-border">
          <p className="text-sm font-medium text-foreground">{t("dns.zone", { name: subdomainSelection.name })}</p>
          <p className="text-xs text-muted-foreground">{t("dns.id", { id: subdomainSelection.id })}</p>
          <div className="mt-3">
            {subdomainRecordsLoading ? (
              <p className="text-sm text-muted-foreground">{t("dns.loadingRecords")}</p>
            ) : subdomainRecords.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("dns.noRecords")}</p>
            ) : (
              <div className="space-y-2">
                {subdomainRecords.map((r) => (
                  <div key={r.id} className="flex items-center justify-between border border-border p-3">
                    <div className="min-w-0">
                      <p className="font-mono text-sm text-foreground truncate">{r.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {r.type} • {t("dns.ttl", { ttl: r.ttl })} •{" "}
                        <Badge variant="outline" className="text-[10px]">{r.proxied ? t("dns.proxied") : t("dns.dns")}</Badge>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="font-mono text-sm text-foreground truncate max-w-[180px]">{r.content}</p>
                      <Button size="sm" variant="outline" onClick={() => {
                        onSetSubdomainEditId(String(r.id));
                        onSetSubdomainEditingRecord({
                          name: r.name, type: r.type, ttl: r.ttl, content: r.content,
                          proxied: !!r.proxied, autoTtl: r.ttl === 1,
                        });
                      }}>
                        {t("actions.edit")}
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => onDeleteSubdomainRecord(r)}>
                        {t("actions.delete")}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Edit record form */}
          {subdomainEditId && subdomainEditingRecord && (
            <div className="mt-4 p-3 border border-border bg-secondary/10">
              <p className="text-sm font-medium mb-2">{t("dns.editRecord")}</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
                <Input placeholder={t("dns.name")} value={subdomainEditingRecord.name}
                  onChange={(e: any) => onSetSubdomainEditingRecord((f: any) => ({ ...f, name: e.target.value }))}
                />
                <select className="border border-border bg-input px-3 py-2 text-sm" value={subdomainEditingRecord.type}
                  onChange={(e: any) => onSetSubdomainEditingRecord((f: any) => ({ ...f, type: e.target.value }))}>
                  <option>A</option> <option>AAAA</option> <option>CNAME</option> <option>TXT</option>
                </select>
                <Input type="number" placeholder={t("dns.ttlShort")} value={subdomainEditingRecord.ttl}
                  onChange={(e: any) => onSetSubdomainEditingRecord((f: any) => ({ ...f, ttl: Number(e.target.value) }))}
                  disabled={!!subdomainEditingRecord.autoTtl}
                />
                <Input placeholder={t("dns.content")} value={subdomainEditingRecord.content}
                  onChange={(e: any) => onSetSubdomainEditingRecord((f: any) => ({ ...f, content: e.target.value }))}
                />
                <div className="flex items-center gap-2">
                  <label className="inline-flex items-center text-sm">
                    <input type="checkbox" className="mr-2" checked={!!subdomainEditingRecord.autoTtl}
                      onChange={(e: any) => onSetSubdomainEditingRecord((f: any) => ({ ...f, autoTtl: e.target.checked }))} />
                    <span className="text-xs text-muted-foreground">{t("dns.autoTtl")}</span>
                  </label>
                  <label className="inline-flex items-center text-sm">
                    <input type="checkbox" className="mr-2" checked={!!subdomainEditingRecord.proxied}
                      onChange={(e: any) => onSetSubdomainEditingRecord((f: any) => ({ ...f, proxied: e.target.checked }))} />
                    <span className="text-xs text-muted-foreground">{t("dns.proxied")}</span>
                  </label>
                </div>
                <Button onClick={onUpdateSubdomainRecord} data-telemetry="organisations:updatesubdomainrecord">{t("actions.save")}</Button>
              </div>
              <div className="mt-2 flex gap-2">
                <Button variant="outline" onClick={() => { onSetSubdomainEditId(null); onSetSubdomainEditingRecord(null); }}>{t("actions.cancel")}</Button>
              </div>
            </div>
          )}

          {/* Add record form */}
          <div className="mt-4 border-t border-border pt-4">
            <p className="text-sm font-medium text-foreground mb-2">{t("dns.addRecordTitle")}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
              <Input placeholder={t("dns.nameExample")} value={subdomainRecordForm.name}
                onChange={(e: any) => onSetSubdomainRecordForm((f: any) => ({ ...f, name: e.target.value }))}
              />
              <select className="border border-border bg-input px-3 py-2 text-sm" value={subdomainRecordForm.type}
                onChange={(e: any) => onSetSubdomainRecordForm((f: any) => ({ ...f, type: e.target.value }))}>
                <option>A</option> <option>AAAA</option> <option>CNAME</option> <option>TXT</option>
              </select>
              <Input type="number" placeholder={t("dns.ttlShort")} value={subdomainRecordForm.ttl}
                onChange={(e: any) => onSetSubdomainRecordForm((f: any) => ({ ...f, ttl: Number(e.target.value) }))}
                disabled={subdomainRecordForm.autoTtl}
              />
              <Input placeholder={t("dns.content")} value={subdomainRecordForm.content}
                onChange={(e: any) => onSetSubdomainRecordForm((f: any) => ({ ...f, content: e.target.value }))}
              />
              <div className="flex items-center gap-2">
                <label className="inline-flex items-center text-sm">
                  <input type="checkbox" className="mr-2" checked={subdomainRecordForm.autoTtl}
                    onChange={(e: any) => onSetSubdomainRecordForm((f: any) => ({ ...f, autoTtl: e.target.checked }))} />
                  <span className="text-xs text-muted-foreground">{t("dns.autoTtl")}</span>
                </label>
                <label className="inline-flex items-center text-sm">
                  <input type="checkbox" className="mr-2" checked={subdomainRecordForm.proxied}
                    onChange={(e: any) => onSetSubdomainRecordForm((f: any) => ({ ...f, proxied: e.target.checked }))} />
                  <span className="text-xs text-muted-foreground">{t("dns.proxied")}</span>
                </label>
              </div>
              <Button onClick={onAddSubdomainRecord} data-telemetry="organisations:addsubdomainrecord">{t("actions.addRecord")}</Button>
            </div>
            <div className="mt-2">
              <label className="text-xs text-muted-foreground">
                {`@ => ${subdomainSelection.name} ; subdomain name => name.${subdomainSelection.name}`}
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}