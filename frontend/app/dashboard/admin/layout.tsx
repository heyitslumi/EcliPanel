"use client"

import { useEffect } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useAuth } from "@/hooks/useAuth"
import { Shield, ArrowLeft } from "lucide-react"

const STAFF_PERMS = [
  "admin:access", "admin:metrics", "admin:export-jobs", "admin:announcements",
  "admin:outbound-emails", "admin:fraud", "admin:settings", "admin:oauth",
  "admin:geoblock:view", "admin:tunnels:read", "admin:plans:view",
  "admin:plans:manage", "admin:plans:delete", "admin:plans:reapply",
  "admin:plans:forcereapply", "admin:payment:manage", "users:read",
  "orders:view", "orders:issue", "orders:update", "orders:delete",
  "org:read", "servers:read", "nodes:read", "eggs:read",
  "databases:read", "soc:read", "roles:read", "logs:read",
  "deletions:write", "idverification:read", "admin:student:verify",
  "tickets:read", "chat:manage", "ai:read",
  "applications:manage", "admin.shorturl.add",
  "admin:mailbox:hi", "admin:mailbox:support", "admin:mailbox:hello",
  "admin:mailbox:contact", "admin:mailbox:security",
  "admin:mailbox:abuse", "admin:mailbox:legal", "admin:mailbox:hq",
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  const router = useRouter()

  const isStaff = !!user && (
    user.role === "admin" || user.role === "rootAdmin" || user.role === "*" ||
    STAFF_PERMS.some((p) => {
      if (!user?.permissions) return false
      const perms = Array.isArray(user.permissions) ? user.permissions : []
      return perms.includes("*") || perms.includes(p)
    })
  )

  useEffect(() => {
    if (!isLoading && !isStaff) router.replace("/dashboard")
  }, [user, isLoading, isStaff, router])

  if (isLoading || !isStaff) return null

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-10 shrink-0 items-center gap-3 border-b border-border bg-card/50 px-4">
        <Link
          href="/dashboard"
          className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Dashboard
        </Link>
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-2">
          <Shield className="h-3.5 w-3.5 text-primary" />
          <span className="text-sm font-semibold text-foreground">Staff Portal</span>
        </div>
      </header>
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  )
}
