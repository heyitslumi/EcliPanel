"use client"

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText } from "lucide-react";

interface OrdersTabProps {
  orgId: string;
  orders: any[];
}

const statusBadge = (status: string): string => {
  if (status === "active") return "border-success/30 bg-success/10 text-success text-xs";
  if (status === "cancelled" || status === "expired") return "border-destructive/30 bg-destructive/10 text-destructive text-xs";
  if (status === "pending" || status === "awaiting_payment") return "border-warning/30 bg-warning/10 text-warning text-xs";
  return "border-border text-muted-foreground text-xs";
};

export function OrdersTab({ orgId, orders }: OrdersTabProps) {
  const t = useTranslations("organisationsDetailPage");
  const downloadInvoice = (orderId: number) => {
    window.open(`/api/organisations/${orgId}/orders/${orderId}/invoice`, "_blank");
  };

  return (
    <div className="border border-border bg-card min-w-0 box-border overflow-hidden">
      <div className="flex items-center justify-between border-b border-border p-4">
        <p className="text-sm font-medium text-foreground">{t("orders.title")}</p>
      </div>
      {orders.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">{t("orders.none")}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="px-4 py-3 text-left font-medium">{t("orders.columns.id")}</th>
                <th className="px-4 py-3 text-left font-medium">{t("orders.columns.description")}</th>
                <th className="px-4 py-3 text-left font-medium">{t("orders.columns.amount")}</th>
                <th className="px-4 py-3 text-left font-medium">{t("orders.columns.status")}</th>
                <th className="px-4 py-3 text-left font-medium">{t("orders.columns.date")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("orders.columns.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-border/50 hover:bg-secondary/20 transition-colors">
                  <td className="px-4 py-3 font-mono text-sm text-foreground">{o.id}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{o.description || t("common.dash")}</td>
                  <td className="px-4 py-3 font-mono text-sm text-foreground">${Number(o.amount ?? 0).toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className={statusBadge(o.status)}>{o.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {o.createdAt ? new Date(o.createdAt).toLocaleDateString() : t("common.dash")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => downloadInvoice(o.id)}
                      className="h-7 px-2 text-xs"
                    >
                      <FileText className="h-3 w-3" />
                      <span className="ml-1 hidden sm:inline">{t("orders.invoice")}</span>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}