"use client"

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PanelHeader } from "@/components/panel/header";
import { PageLayout, SectionHeader } from "@/components/panel/shared";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-client";
import { API_ENDPOINTS } from "@/lib/panel-config";
import { useOrgPermissions } from "@/hooks/useOrgPermissions";
import { toast } from "@/hooks/use-toast";
import { CreditCard, Globe, FileText, Loader2, ArrowRight, Check } from "lucide-react";

export default function OrgBillingPage() {
  const t = useTranslations("orgBilling");
  const bt = useTranslations("billingPage");
  const params = useParams();
  const orgId = (params?.id as string) ?? "";
  const perms = useOrgPermissions(orgId);
  const router = useRouter();

  const [org, setOrg] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [activateMode, setActivateMode] = useState<"now" | "renewal">("now");
  const [confirmSwitch, setConfirmSwitch] = useState<any | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [formationFee, setFormationFee] = useState(1);
  const [dnsAddonPrice, setDnsAddonPrice] = useState(3);

  useEffect(() => {
    if (!orgId) return;
    Promise.all([
      apiFetch(API_ENDPOINTS.organisationDetail.replace(":id", orgId)),
      apiFetch(API_ENDPOINTS.plans).catch(() => []),
      apiFetch(`${API_ENDPOINTS.orders}?orgId=${orgId}`).catch(() => []),
      apiFetch(API_ENDPOINTS.panelSettings).catch(() => ({})),
    ]).then(([orgData, plansData, ordersData, settings]) => {
      setOrg(orgData);
      const list = Array.isArray(plansData) ? plansData : [];
      setPlans(list.filter((p: any) => p.type !== "free" && p.type !== "educational" && p.type !== "enterprise" && !p.hiddenFromBilling));
      setOrders(Array.isArray(ordersData) ? ordersData : []);
      const s = settings as Record<string, any> || {};
      if (s.org_formation_fee != null) setFormationFee(Number(s.org_formation_fee) || 1);
      if (s.org_dns_addon_price != null) setDnsAddonPrice(Number(s.org_dns_addon_price) || 3);
    }).finally(() => setLoading(false));
  }, [orgId]);

  if (!perms.canManage) {
    return (
      <>
        <PanelHeader title={t("title")} description={org?.handle || ""} />
        <PageLayout><p className="p-8 text-center text-sm text-muted-foreground">{t("unauthorized")}</p></PageLayout>
      </>
    );
  }

  if (loading) {
    return (
      <>
        <PanelHeader title={t("title")} />
        <PageLayout><p className="p-8 text-center text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />{t("loading")}</p></PageLayout>
      </>
    );
  }

  const currentTier = org?.portalTier || "none";
  const isPending = org?.status === "pending" || currentTier === "none";
  const activePlanId = org?.planId || orders.find((o: any) => o.status === 'active' && o.planId && !(o.notes || '').includes('dns_addon'))?.planId;
  const hasDnsAddon = orders.some((o: any) => o.status === 'active' && (o.notes || '').includes('dns_addon'));
  const activePlanOrder = orders.find((o: any) => o.status === 'active' && o.planId && !(o.notes || '').includes('dns_addon'));

  const handleSwitchPlan = async () => {
    if (!confirmSwitch) return;
    const plan = confirmSwitch;
    setSwitching(true);
    try {
      const fee = isPending ? formationFee : 0;
      const totalAmount = (plan.price || 0) + formationFee;
      const items = [{ description: plan.name, quantity: 1, price: plan.price || 0 }];
      if (fee > 0) items.push({ description: t("formationFee"), quantity: 1, price: formationFee });

      const res = await apiFetch(`/api/organisations/${orgId}/orders`, {
        method: "POST",
        body: JSON.stringify({
          planId: plan.id,
          amount: totalAmount,
          description: plan.name,
          activateMode,
          items: JSON.stringify(items),
        }),
      });
      if (res?.order?.id) {
        if (totalAmount === 0) {
          toast({ title: t("planSwitched") });
          setTimeout(() => window.location.reload(), 1000);
        } else {
          router.push(`/dashboard/billing/checkout?order=${res.order.id}`);
        }
      }
    } catch (e: any) {
      toast({ title: t("switchFailed"), description: e?.message, variant: "destructive" });
    } finally {
      setSwitching(false);
      setConfirmSwitch(null);
    }
  };

  const handleBuyDns = async () => {
    setSwitching(true);
    try {
      const res = await apiFetch(`/api/organisations/${orgId}/orders`, {
        method: "POST",
        body: JSON.stringify({
          planId: 0,
          amount: dnsAddonPrice,
          description: "DNS Management Add-on",
          activateMode: "now",
          notes: "dns_addon:true",
          items: JSON.stringify([{ description: "DNS Management Add-on (monthly)", quantity: 1, price: dnsAddonPrice }]),
        }),
      });
      if (res?.order?.id) {
        router.push(`/dashboard/billing/checkout?order=${res.order.id}`);
      }
    } catch (e: any) {
      toast({ title: t("dnsPurchaseFailed"), description: e?.message, variant: "destructive" });
    } finally {
      setSwitching(false);
    }
  };

  const downloadInvoice = (orderId: number) => {
    window.open(`/api/organisations/${orgId}/orders/${orderId}/invoice`, "_blank");
  };

  const formatPrice = (price: number, compact?: boolean) => {
    if (price === 0) return "$0";
    return `$${price.toFixed(2)}${compact ? "" : ""}`;
  };

  const statusBadge = (status: string) => {
    if (status === "active") return "border-success/30 bg-success/10 text-success";
    if (status === "cancelled" || status === "expired") return "border-destructive/30 bg-destructive/10 text-destructive";
    if (status === "pending" || status === "awaiting_payment") return "border-warning/30 bg-warning/10 text-warning";
    return "border-border text-muted-foreground";
  };

  const activePlanObj = activePlanId ? plans.find((p: any) => p.id === activePlanId) : null;
  const activePlanTitle = isPending ? t("noPlan") : (activePlanObj?.name || currentTier);

  return (
    <>
      <PanelHeader title={t("title")} description={org?.name || org?.handle || ""} />
      <ScrollArea className="flex-1 overflow-x-hidden max-w-[100vw] box-border">
        <PageLayout>
          {/* Pending activation banner */}
          {isPending && (
            <div className="border border-warning/30 bg-warning/10 p-6 mb-6 text-center">
              <CreditCard className="h-10 w-10 text-warning mx-auto mb-3" />
              <p className="text-base font-semibold text-foreground mb-1">{t("pendingTitle")}</p>
              <p className="text-sm text-muted-foreground mb-4">{t("pendingDesc")}</p>
              {isPending && activePlanOrder && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="mb-3"
                  onClick={async () => {
                    try {
                      await apiFetch(`/api/organisations/${orgId}/activate`, { method: "POST" });
                      window.location.reload();
                    } catch (e: any) {
                      toast({ title: t("activationFailed"), description: e?.message, variant: "destructive" });
                    }
                  }}
                >
                  {t("retryActivation")}
                </Button>
              )}
              <p className="text-xs text-muted-foreground">{t("pendingHint")}</p>
            </div>
          )}

          {!isPending && (
            <>
              {/* Current plan */}
              <SectionHeader title={t("currentPlan")} description={t("currentPlanDesc")} />
              <div className="border border-border bg-card p-4 flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <CreditCard className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-foreground capitalize">{activePlanTitle}</p>
                    {activePlanObj?.description && (
                      <p className="text-xs text-muted-foreground">{activePlanObj.description}</p>
                    )}
                    {activePlanOrder && activePlanOrder.expiresAt && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Renews: {new Date(activePlanOrder.expiresAt).toLocaleDateString()}
                      </p>
                    )}
                    {activePlanObj && (
                      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                        {activePlanObj.memory && <span className="flex items-center gap-1">{t("specs.memory", { val: activePlanObj.memory })}</span>}
                        {activePlanObj.disk && <span className="flex items-center gap-1">{t("specs.disk", { val: activePlanObj.disk })}</span>}
                        {activePlanObj.cpu && <span className="flex items-center gap-1">{t("specs.cpu", { val: activePlanObj.cpu })}</span>}
                        {activePlanObj.serverLimit && <span className="flex items-center gap-1">{t("specs.servers", { val: activePlanObj.serverLimit })}</span>}
                      </div>
                    )}
                  </div>
                </div>
                <Badge className="bg-primary/20 text-primary border-0 text-xs capitalize">{currentTier}</Badge>
              </div>

              {/* DNS Add-on */}
              <SectionHeader title={t("addons")} description={t("addonsDesc")} />
              <div className="border border-border bg-card p-4 flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <Globe className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-foreground">{t("dnsAddon")}</p>
                    <p className="text-xs text-muted-foreground">{t("dnsAddonDesc")}</p>
                  </div>
                </div>
                <Button size="sm" onClick={handleBuyDns} disabled={switching || hasDnsAddon || currentTier === "enterprise"}>
                  {switching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : currentTier === "enterprise" ? t("included") : hasDnsAddon ? t("dnsActive") : `Buy — $${dnsAddonPrice}/mo`}
                </Button>
              </div>
            </>
          )}

          {/* Plan selection — shown for both pending and active */}
          <SectionHeader title={t("availablePlans")} description={isPending ? t("availablePlansPendingDesc") : t("availablePlansDesc")} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 mb-4">
            {plans.map((plan: any) => {
              const isCurrent = !isPending && activePlanId === plan.id;
              const cardPrice = isPending ? (plan.price || 0) + formationFee : (plan.price || 0);
              return (
                <div
                  key={plan.id}
                  className={`border p-5 transition-all ${
                    isCurrent ? "border-primary/50 bg-primary/5 shadow-[0_0_20px_var(--glow)]" : "border-border bg-secondary/30 hover:border-primary/20"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-foreground">{plan.name}</h3>
                    <Badge variant="outline" className="text-[10px] capitalize">{plan.type}</Badge>
                    {isCurrent && <Badge className="bg-primary/20 text-primary border-0 text-[10px]">{bt("currentSubscription.active")}</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{plan.description || ""}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {plan.price != null ? `${formatPrice(cardPrice, true)}/mo` : bt("currentSubscription.contactSales")}
                    {isPending && <span className="text-warning ml-1">({t("inclFee")})</span>}
                  </p>
                  <ul className="mt-3 flex flex-col gap-1.5">
                    {plan.memory && <li className="flex items-center gap-2 text-xs text-muted-foreground"><Check className="h-3 w-3 text-success" />{t("specs.memory", { val: plan.memory })}</li>}
                    {plan.disk && <li className="flex items-center gap-2 text-xs text-muted-foreground"><Check className="h-3 w-3 text-success" />{t("specs.disk", { val: plan.disk })}</li>}
                    {plan.cpu && <li className="flex items-center gap-2 text-xs text-muted-foreground"><Check className="h-3 w-3 text-success" />{t("specs.cpu", { val: plan.cpu })}</li>}
                    {plan.serverLimit && <li className="flex items-center gap-2 text-xs text-muted-foreground"><Check className="h-3 w-3 text-success" />{t("specs.servers", { val: plan.serverLimit })}</li>}
                    {plan.databases > 0 && <li className="flex items-center gap-2 text-xs text-muted-foreground"><Check className="h-3 w-3 text-success" />{t("specs.databases", { val: plan.databases })}</li>}
                    {plan.backups > 0 && <li className="flex items-center gap-2 text-xs text-muted-foreground"><Check className="h-3 w-3 text-success" />{t("specs.backups", { val: plan.backups })}</li>}
                  </ul>
                  {isCurrent ? (
                    <div className="mt-4 flex w-full items-center justify-center gap-2 border border-primary/30 bg-primary/10 py-2 text-xs font-medium text-primary">
                      <Check className="h-3 w-3" />{bt("currentSubscription.currentPlan")}
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmSwitch(plan)}
                      disabled={switching}
                      className="mt-4 flex w-full items-center justify-center gap-2 border border-border bg-transparent py-2 text-xs font-medium text-foreground transition-colors hover:bg-secondary/50 disabled:opacity-50"
                    >
                      {switching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
                      {t("switchTo")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Invoice history */}
          <SectionHeader title={t("invoices")} description={t("invoicesDesc")} />
          <div className="border border-border bg-card min-w-0 box-border overflow-hidden mb-4">
            {orders.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">{t("noInvoices")}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="px-4 py-3 text-left font-medium">ID</th>
                      <th className="px-4 py-3 text-left font-medium">{t("columns.description")}</th>
                      <th className="px-4 py-3 text-left font-medium">{t("columns.amount")}</th>
                      <th className="px-4 py-3 text-left font-medium">{t("columns.status")}</th>
                      <th className="px-4 py-3 text-left font-medium">{t("columns.date")}</th>
                      <th className="px-4 py-3 text-right font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o: any) => (
                      <tr key={o.id} className="border-b border-border/50 hover:bg-secondary/20 transition-colors">
                        <td className="px-4 py-3 font-mono text-sm text-foreground">{o.id}</td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">{o.description || "—"}</td>
                        <td className="px-4 py-3 font-mono text-sm text-foreground">${Number(o.amount ?? 0).toFixed(2)}</td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={`text-xs ${statusBadge(o.status)}`}>{o.status}</Badge>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {o.createdAt ? new Date(o.createdAt).toLocaleDateString() : "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button size="sm" variant="outline" onClick={() => downloadInvoice(o.id)} className="h-7 px-2 text-xs">
                            <FileText className="h-3 w-3" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </PageLayout>
      </ScrollArea>

      {/* Switch confirmation modal */}
      {confirmSwitch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConfirmSwitch(null)}>
          <div className="w-full max-w-md border border-border bg-card p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-foreground">{bt("currentSubscription.switchTitle")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("confirmSwitchDesc", { target: confirmSwitch.name, current: activePlanTitle })}
            </p>
            <div className="mt-6 flex flex-col gap-3">
              {!isPending && (
                <div className="border border-border bg-secondary/20 p-3">
                  <div className="flex flex-col gap-2">
                    <label className={`flex items-center gap-2 p-2 cursor-pointer border transition-colors ${activateMode === 'now' ? 'border-primary/50 bg-primary/5' : 'border-border hover:border-primary/20'}`}>
                      <input type="radio" name="activateMode" checked={activateMode === 'now'} onChange={() => setActivateMode('now')} className="accent-primary" />
                      <span className="text-sm text-foreground">{bt("currentSubscription.activateNow")}</span>
                    </label>
                    <label className={`flex items-center gap-2 p-2 cursor-pointer border transition-colors ${activateMode === 'renewal' ? 'border-primary/50 bg-primary/5' : 'border-border hover:border-primary/20'}`}>
                      <input type="radio" name="activateMode" checked={activateMode === 'renewal'} onChange={() => setActivateMode('renewal')} className="accent-primary" />
                      <span className="text-sm text-foreground">{bt("currentSubscription.activateOnRenewal")}</span>
                    </label>
                  </div>
                </div>
              )}
              <button
                onClick={handleSwitchPlan}
                disabled={switching}
                className="flex items-center justify-center gap-2 bg-primary py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {switching ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                {bt("currentSubscription.confirmSwitch")}
              </button>
              <button
                onClick={() => setConfirmSwitch(null)}
                disabled={switching}
                className="flex items-center justify-center gap-2 border border-border py-3 text-sm text-muted-foreground transition-colors hover:text-foreground hover:bg-secondary/50 disabled:opacity-50"
              >
                {bt("currentSubscription.goBack")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}