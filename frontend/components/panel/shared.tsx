"use client"

import { memo, type ReactNode } from "react"
import { type LucideIcon, Loader2, Search, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"

interface StatCardProps {
  title: string
  value: string | number
  subtitle?: string
  icon: LucideIcon
  trend?: { value: number; label: string }
  color?: string
  className?: string
}

export const StatCard = memo(function StatCard({ title, value, subtitle, icon: Icon, trend, color = "primary", className }: StatCardProps) {
  return (
    <div
      className={cn(
        "group relative overflow-hidden border border-border bg-card p-5 transition-all duration-300 hover:border-primary/30 hover:shadow-[0_0_15px_var(--glow)]",
        className
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {title}
          </p>
          <p className="text-2xl font-bold text-foreground">{value}</p>
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
          {trend && (
            <p
              className={cn(
                "text-xs font-medium",
                trend.value >= 0 ? "text-success" : "text-destructive"
              )}
            >
              {trend.value >= 0 ? "+" : ""}
              {trend.value}% {trend.label}
            </p>
          )}
        </div>
        <div className="bg-primary/10 p-2.5 text-primary transition-colors group-hover:bg-primary/20">
          <Icon className="h-5 w-5" />
        </div>
      </div>
      {/* Glow accent line */}
      <div className="absolute bottom-0 left-0 h-[2px] w-full bg-gradient-to-r from-transparent via-primary/50 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
    </div>
  )
})

/**
 * Status indicator dot with label
 */
export function StatusBadge({ status }: { status: "online" | "offline" | "starting" | "running" | "stopped" | "pending" | "open" | "opened" | "replied" | "awaiting_staff_reply" | "closed" | "urgent" | "high" | "medium" | "low" }) {
  const t = useTranslations("panelShared")
  const config: Record<string, { color: string; label: string }> = {
    online: { color: "bg-success", label: t("status.online") },
    running: { color: "bg-success", label: t("status.running") },
    open: { color: "bg-info", label: t("status.open") },
    opened: { color: "bg-info", label: t("status.opened") },
    replied: { color: "bg-info", label: t("status.replied") },
    awaiting_staff_reply: { color: "bg-warning", label: t("status.awaitingStaff") },
    starting: { color: "bg-warning", label: t("status.starting") },
    pending: { color: "bg-warning", label: t("status.pending") },
    medium: { color: "bg-warning", label: t("status.medium") },
    offline: { color: "bg-destructive", label: t("status.offline") },
    stopped: { color: "bg-destructive", label: t("status.stopped") },
    closed: { color: "bg-muted-foreground", label: t("status.closed") },
    urgent: { color: "bg-destructive", label: t("status.urgent") },
    high: { color: "bg-destructive", label: t("status.high") },
    low: { color: "bg-success", label: t("status.low") },
  }

  const { color, label } = config[status] ?? { color: "bg-muted-foreground", label: status }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className={cn("h-2 w-2 rounded-full", color)} />
      <span className="text-muted-foreground">{label}</span>
    </span>
  )
}

/**
 * Section header for dashboard pages
 */
export function SectionHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-foreground truncate">{title}</h2>
        {description && <p className="text-sm text-muted-foreground truncate">{description}</p>}
      </div>
      {action}
    </div>
  )
}

/**
 * Progress bar with label
 */
export function UsageBar({ label, value, max = 100, color = "primary" }: { label: string; value: number; max?: number; color?: string }) {
  const percentage = Math.min((value / max) * 100, 100)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono text-foreground">{value}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden bg-secondary">
        <div
          className={cn(
            "h-full transition-all duration-500",
            percentage > 90 ? "bg-destructive" : percentage > 70 ? "bg-warning" : "bg-primary"
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  )
}

export function PageLayout({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-6 p-3 sm:p-5 md:p-6 max-w-[100vw] w-full min-w-0 box-border", className)}>
      {children}
    </div>
  )
}

export function CardStack({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-3", className)}>{children}</div>
}

export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4", className)}>
      {children}
    </div>
  )
}

export function CardGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2 xl:grid-cols-3", className)}>
      {children}
    </div>
  )
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <div className={cn("relative flex-1 min-w-0", className)}>
      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60 pointer-events-none" />
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-border bg-card pl-10 pr-9 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
      />
      {value && (
        <button
          onClick={() => onChange("")}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground p-2 active:scale-90 transition-all touch-target"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

export function AlertBanner({
  variant = "warning",
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  variant?: "warning" | "destructive" | "info" | "success"
  icon?: LucideIcon
  title?: string
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  const styles: Record<string, string> = {
    warning: "border-amber-500/30 bg-amber-500/5 text-foreground",
    destructive: "border-destructive/30 bg-destructive/5 text-foreground",
    info: "border-info/30 bg-info/5 text-foreground",
    success: "border-success/30 bg-success/5 text-foreground",
  }
  return (
    <div className={cn("border p-4 text-sm", styles[variant], className)}>
      <div className="flex items-start gap-2">
        {Icon && <Icon className={cn("mt-0.5 h-4 w-4 flex-shrink-0", {
          "text-amber-400": variant === "warning",
          "text-destructive": variant === "destructive",
          "text-info": variant === "info",
          "text-success": variant === "success",
        })} />}
        <div className="min-w-0 flex-1">
          {title && <p className="font-semibold">{title}</p>}
          {children && <div className={cn(title && "mt-1", "text-xs text-muted-foreground")}>{children}</div>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center px-6">
      {Icon && (
        <div className="h-16 w-16 bg-secondary/30 flex items-center justify-center mb-5">
          <Icon className="h-7 w-7 text-muted-foreground/40" />
        </div>
      )}
      <h3 className="text-base font-semibold text-foreground mb-1.5">{title}</h3>
      {description && <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}

export function LoadingState({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <div className="h-12 w-12 bg-primary/10 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
      {label && <p className="text-sm text-muted-foreground">{label}</p>}
    </div>
  )
}
