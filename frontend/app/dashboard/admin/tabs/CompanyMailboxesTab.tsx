"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useTranslations } from "next-intl"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { useAuth, hasPermission } from "@/hooks/useAuth"
import { useToast } from "@/hooks/use-toast"
import { useDebounce } from "@/hooks/useDebounce"
import { apiFetch } from "@/lib/api-client"
import { API_ENDPOINTS } from "@/lib/panel-config"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Toaster } from "@/components/ui/toaster"
import {
  Mail,
  Shield,
  Loader2,
  RefreshCw,
  KeyRound,
  ExternalLink,
  Copy,
  Check,
  Search,
  AlertTriangle,
  Bug,
  Paperclip,
  ArrowLeft,
  ArrowRight,
  Inbox,
  Reply,
  Trash2,
  Send,
  CheckCheck,
  ReplyAll,
  MessageSquarePlus,
  X,
  Clock,
  AtSign,
} from "lucide-react"

const COMPANY_PERMS = [
  "admin:mailbox:hi",
  "admin:mailbox:support",
  "admin:mailbox:hello",
  "admin:mailbox:contact",
  "admin:mailbox:security",
  "admin:mailbox:abuse",
  "admin:mailbox:legal",
  "admin:mailbox:hq",
] as const

type MailboxInfo = {
  localPart: string
  email: string
  aliases: Array<{ address: string; localPart: string }>
  provisioned: boolean
  unreadCount?: number | null
}

type MailboxListResponse = {
  mailboxes: MailboxInfo[]
  sogoUrl: string
}

type MailMessage = {
  id: number
  messageId?: string
  fromAddress?: string
  toAddress?: string
  subject: string
  body: string
  html?: string
  receivedAt: string
  read: boolean
  replied: boolean
  folder: string
  isSpam: boolean
  isVirus: boolean
  spamScore?: number
  virusName?: string
  attachments?: Array<{ filename: string; url: string; contentType?: string; size?: number }>
}

type CredsInfo = {
  email: string
  password: string
  sogoUrl: string
}

type Folder = "INBOX" | "Sent" | "Trash" | "Junk"
type Filter = "all" | "unread" | "read" | "replied" | "not-replied"

const FOLDERS: Folder[] = ["INBOX", "Sent", "Trash", "Junk"]
const FILTERS: Filter[] = ["all", "unread", "read", "replied", "not-replied"]

type CacheEntry = {
  messages: MailMessage[]
  total: number
  unreadCount: number | null
  loadedAt: number
}

function MarkdownBody({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-full break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 prose-p:my-1 prose-pre:my-2 prose-pre:bg-background/50 prose-pre:border prose-pre:border-border/50 prose-pre:text-xs prose-code:text-primary prose-code:bg-primary/10 prose-code:px-1 prose-code:py-0.5 prose-code:text-xs prose-code:before:content-none prose-code:after:content-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function markdownToHtml(md: string): string {
  if (!md.trim()) return ""
  const escaped = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
  const lines = escaped.split("\n")
  const out: string[] = []
  let inUl = false
  let inOl = false
  const closeList = () => {
    if (inUl) { out.push("</ul>"); inUl = false }
    if (inOl) { out.push("</ol>"); inOl = false }
  }
  const inlineFormat = (line: string) =>
    line
      .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/~~(.+?)~~/g, "<s>$1</s>")
      .replace(/`([^`]+)`/g, "<code style=\"background:hsl(var(--card));padding:1px 5px;border-radius:4px;font-size:0.875em\">$1</code>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:hsl(var(--primary))">$1</a>')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const raw = line.trimStart()
    if (/^#{3}\s/.test(raw)) { closeList(); out.push(`<h3>${raw.slice(3).trim()}</h3>`); continue }
    if (/^#{2}\s/.test(raw)) { closeList(); out.push(`<h2>${raw.slice(2).trim()}</h2>`); continue }
    if (/^#{1}\s/.test(raw)) { closeList(); out.push(`<h1>${raw.slice(1).trim()}</h1>`); continue }
    if (/^[-*]\s/.test(raw)) {
      if (!inUl) { out.push("<ul>"); inUl = true }
      out.push(`<li>${inlineFormat(raw.slice(2).trim())}</li>`)
      continue
    }
    if (/^\d+\.\s/.test(raw)) {
      if (!inOl) { out.push("<ol>"); inOl = true }
      out.push(`<li>${inlineFormat(raw.replace(/^\d+\.\s/, "").trim())}</li>`)
      continue
    }
    closeList()
    if (!raw.trim()) { out.push(""); continue }
    out.push(`<p>${inlineFormat(raw)}</p>`)
  }
  closeList()
  return out.join("\n")
}

export default function CompanyMailboxesTab() {
  const t = useTranslations("companyMailboxesTab")
  const { user } = useAuth()
  const { toast } = useToast()

  const [mailboxes, setMailboxes] = useState<MailboxInfo[]>([])
  const [sogoUrl, setSogoUrl] = useState("")
  const [loadingList, setLoadingList] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [folder, setFolder] = useState<Folder>("INBOX")
  const [filter, setFilter] = useState<Filter>("all")
  const [messages, setMessages] = useState<MailMessage[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [limit] = useState(20)
  const [searchInput, setSearchInput] = useState("")
  const debouncedSearch = useDebounce(searchInput, 450)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [selectedMessage, setSelectedMessage] = useState<MailMessage | null>(null)
  const [rotating, setRotating] = useState(false)
  const [creds, setCreds] = useState<CredsInfo | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [replyTo, setReplyTo] = useState<MailMessage | null>(null)
  const [composeMode, setComposeMode] = useState(false)
  const [replyForm, setReplyForm] = useState({ to: "", cc: "", bcc: "", subject: "", body: "", priority: "normal", template: "notification" })
  const [sendingReply, setSendingReply] = useState(false)
  const [previewMode, setPreviewMode] = useState(false)
  const [previewHtml, setPreviewHtml] = useState("")
  const [previewMeta, setPreviewMeta] = useState<{ from: string; subject: string } | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [purgeAddress, setPurgeAddress] = useState("")
  const [purging, setPurging] = useState(false)
  const [purgeOpen, setPurgeOpen] = useState(false)
  const [confirmState, setConfirmState] = useState<{
    title: string
    description?: string
    confirmLabel: string
    destructive: boolean
    action: () => Promise<void> | void
  } | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map())
  const currentKeyRef = useRef("")

  const isRootAdmin = !!user && (user.role === "rootAdmin" || user.role === "*")

  const hasMailboxPerm = useCallback(
    (localPart: string) => !!user && hasPermission(user, `admin:mailbox:${localPart}`),
    [user]
  )

  const loadMailboxes = useCallback(async () => {
    setLoadingList(true)
    try {
      const data = await apiFetch(API_ENDPOINTS.adminCompanyMailboxes)
      const list: MailboxInfo[] = (data?.mailboxes || [])
        .filter((m: MailboxInfo) => hasMailboxPerm(m.localPart) || m.aliases.some(a => hasMailboxPerm(a.localPart)))
      setMailboxes(list)
      setSogoUrl(data?.sogoUrl || "")
      setSelected(prev => (prev && list.some(m => m.localPart === prev) ? prev : (list[0]?.localPart ?? null)))
    } catch {
      setMailboxes([])
    } finally {
      setLoadingList(false)
    }
  }, [hasMailboxPerm])

  const applyMessages = useCallback((result: { messages: MailMessage[]; total: number }, resetSelection: boolean) => {
    setMessages(result.messages)
    setTotal(result.total)
    if (resetSelection) setSelectedMessage(null)
  }, [])

  const loadMessages = useCallback(
    async (
      localPart: string,
      f: Folder,
      flt: Filter,
      p = 1,
      q = "",
      opts: { background?: boolean } = {}
    ) => {
      const key = `${localPart}|${f}|${flt}|${p}|${q}`
      const cached = cacheRef.current.get(key)

      if (!opts.background) {
        currentKeyRef.current = key
        setPage(p)
        if (cached) {
          applyMessages(cached, true)
          setLoadingMessages(false)
          void loadMessages(localPart, f, flt, p, q, { background: true })
          return
        }
        setLoadingMessages(true)
      } else {
        setRefreshing(true)
      }

      try {
        const params = new URLSearchParams({ page: String(p), limit: String(limit), folder: f })
        if (flt === "unread") params.set("unread", "true")
        else if (flt === "read") params.set("read", "true")
        else if (flt === "replied") params.set("replied", "true")
        else if (flt === "not-replied") params.set("replied", "false")
        if (q) params.set("q", q)
        const data = await apiFetch(
          `${API_ENDPOINTS.adminCompanyMailboxMessages.replace(":address", localPart)}?${params.toString()}`
        )

        const result: CacheEntry = {
          messages: data?.messages || [],
          total: data?.meta?.total || 0,
          unreadCount: typeof data?.meta?.unreadCount === "number" ? data.meta.unreadCount : null,
          loadedAt: Date.now(),
        }
        cacheRef.current.set(key, result)

        if (result.unreadCount !== null) {
          const unread = result.unreadCount
          setMailboxes(prev =>
            prev.map(m => (m.localPart === localPart ? { ...m, unreadCount: unread } : m))
          )
        }
        setLastUpdated(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))
        if (!opts.background || key === currentKeyRef.current) {
          applyMessages(result, !opts.background)
        }
      } catch {
        if (!opts.background) applyMessages({ messages: [], total: 0 }, true)
      } finally {
        setLoadingMessages(false)
        setRefreshing(false)
      }
    },
    [limit, applyMessages]
  )

  useEffect(() => {
    loadMailboxes()
  }, [loadMailboxes])

  useEffect(() => {
    if (selected) loadMessages(selected, folder, filter, 1, debouncedSearch)
  }, [selected, folder, filter, debouncedSearch, loadMessages])

  useEffect(() => {
    if (!selected) return
    const id = setInterval(() => {
      if (document.hidden) return
      void loadMessages(selected, folder, filter, page, debouncedSearch, { background: true })
    }, 60_000)
    return () => clearInterval(id)
  }, [selected, folder, filter, page, debouncedSearch, loadMessages])

  const selectMailbox = (localPart: string) => {
    setSelected(localPart)
    setFolder("INBOX")
    setFilter("all")
    setPage(1)
    setSelectedMessage(null)
  }

  const goToPage = (p: number) => {
    if (!selected) return
    void loadMessages(selected, folder, filter, p, debouncedSearch)
  }

  const refreshNow = () => {
    if (!selected) return
    void loadMessages(selected, folder, filter, page, debouncedSearch, { background: true })
  }

  const updateCurrentView = useCallback(
    (updater: (m: MailMessage[]) => MailMessage[], totalUpdater?: (t: number) => number) => {
      const key = currentKeyRef.current
      const cached = cacheRef.current.get(key)
      if (cached) {
        cacheRef.current.set(key, {
          ...cached,
          messages: updater(cached.messages),
          total: totalUpdater ? totalUpdater(cached.total) : cached.total,
        })
      }
      setMessages(prev => updater(prev))
      if (totalUpdater) setTotal(prev => totalUpdater(prev))
    },
    []
  )

  const runConfirm = async () => {
    if (!confirmState) return
    setConfirmBusy(true)
    try {
      await confirmState.action()
      setConfirmState(null)
    } finally {
      setConfirmBusy(false)
    }
  }

  const requestRotate = (localPart: string) => {
    setConfirmState({
      title: t("rotateConfirm"),
      confirmLabel: t("rotatePassword"),
      destructive: false,
      action: () => rotatePassword(localPart),
    })
  }

  const rotatePassword = async (localPart: string) => {
    setRotating(true)
    try {
      const data = await apiFetch(
        API_ENDPOINTS.adminCompanyMailboxRotate.replace(":address", localPart),
        { method: "POST" }
      )
      setCreds({
        email: data.email,
        password: data.password,
        sogoUrl: data.sogoUrl,
      })
      toast({ title: t("passwordRotated") })
    } catch (e: any) {
      toast({ title: t("rotateFailed", { reason: e?.message || "" }), variant: "destructive" })
    } finally {
      setRotating(false)
    }
  }

  const setMessageRead = async (msg: MailMessage, read: boolean) => {
    if (!selected) return
    const prev = msg.read
    const removing = (filter === "unread" && read) || (filter === "read" && !read)
    updateCurrentView(
      list => {
        let next = list.map(m => (m.id === msg.id ? { ...m, read } : m))
        if (removing) next = next.filter(m => m.id !== msg.id)
        return next
      },
      removing ? prevTotal => Math.max(0, prevTotal - 1) : undefined
    )
    setSelectedMessage(s => (s && s.id === msg.id ? { ...s, read } : s))
    setActionBusy(true)
    try {
      const updated = await apiFetch(
        `${API_ENDPOINTS.adminCompanyMailboxMessages.replace(":address", selected)}/${msg.id}/read`,
        { method: "POST", body: JSON.stringify({ read }) }
      )
      if (!updated?.success) throw new Error("bad response")
      if (folder === "INBOX") {
        setMailboxes(prev =>
          prev.map(m => (m.localPart === selected ? { ...m, unreadCount: Math.max(0, (m.unreadCount || 0) + (read ? -1 : 1)) } : m))
        )
      }
      toast({ title: read ? t("markedRead") : t("markedUnread") })
    } catch (e: any) {
      updateCurrentView(list => list.map(m => (m.id === msg.id ? { ...m, read: prev } : m)))
      setSelectedMessage(s => (s && s.id === msg.id ? { ...s, read: prev } : s))
      toast({ title: t("actionFailed", { reason: e?.message || "" }), variant: "destructive" })
    } finally {
      setActionBusy(false)
    }
  }

  const requestDelete = (msg: MailMessage) => {
    const permanent = msg.folder === "Trash"
    setConfirmState({
      title: permanent ? t("deleteForeverConfirm") : t("deleteConfirm"),
      confirmLabel: permanent ? t("deleteForever") : t("delete"),
      destructive: true,
      action: () => doDelete(msg, permanent),
    })
  }

  const doDelete = async (msg: MailMessage, permanent: boolean) => {
    if (!selected) return
    const prev = messages
    updateCurrentView(
      list => list.filter(m => m.id !== msg.id),
      prevTotal => Math.max(0, prevTotal - 1)
    )
    setSelectedMessage(null)
    setActionBusy(true)
    try {
      const updated = await apiFetch(
        `${API_ENDPOINTS.adminCompanyMailboxMessages.replace(":address", selected)}/${msg.id}`,
        { method: "DELETE" }
      )
      if (!updated?.success) throw new Error("bad response")
      toast({ title: permanent ? t("deletedForever") : t("movedToTrash") })
    } catch (e: any) {
      setMessages(prev)
      const key = currentKeyRef.current
      const cached = cacheRef.current.get(key)
      if (cached) cacheRef.current.set(key, { ...cached, messages: prev })
      toast({ title: t("actionFailed", { reason: e?.message || "" }), variant: "destructive" })
    } finally {
      setActionBusy(false)
    }
  }

  const openReply = (msg: MailMessage) => {
    setReplyTo(msg)
    setComposeMode(false)
    setPreviewMode(false)
    setReplyForm({
      to: msg.fromAddress || "",
      cc: "",
      bcc: "",
      subject: msg.subject ? `Re: ${msg.subject.replace(/^re:\s*/i, "")}` : "",
      body: "",
      priority: "normal",
      template: "notification",
    })
  }

  const openCompose = () => {
    setReplyTo(null)
    setComposeMode(true)
    setPreviewMode(false)
    setReplyForm({ to: "", cc: "", bcc: "", subject: "", body: "", priority: "normal", template: "notification" })
  }

  const closeComposer = () => {
    setReplyTo(null)
    setComposeMode(false)
    setPreviewMode(false)
  }

  const insertMarkdown = (before: string, after: string, placeholder?: string) => {
    const ta = bodyRef.current
    const start = ta?.selectionStart ?? replyForm.body.length
    const end = ta?.selectionEnd ?? replyForm.body.length
    const sel = replyForm.body.slice(start, end) || placeholder || ""
    const next = replyForm.body.slice(0, start) + before + sel + after + replyForm.body.slice(end)
    setReplyForm(prev => ({ ...prev, body: next }))
    requestAnimationFrame(() => {
      if (ta) {
        ta.focus()
        ta.setSelectionRange(start + before.length, start + before.length + sel.length)
      }
    })
  }

  const togglePreview = async () => {
    if (previewMode) {
      setPreviewMode(false)
      return
    }
    if (!selected) return
    setLoadingPreview(true)
    try {
      const data = await apiFetch(
        API_ENDPOINTS.adminCompanyMailboxPreview.replace(":address", selected),
        {
          method: "POST",
          body: JSON.stringify({
            subject: replyForm.subject.trim(),
            body: replyForm.body,
            html: markdownToHtml(replyForm.body),
            template: replyForm.template,
          }),
        }
      )
      setPreviewHtml(data?.html || "")
      setPreviewMeta({ from: data?.from || "", subject: data?.subject || "" })
      setPreviewMode(true)
    } catch {
      setPreviewMode(false)
    } finally {
      setLoadingPreview(false)
    }
  }

  const sendReply = async () => {
    if (!selected || !replyForm.body.trim() || !replyForm.to.trim()) return
    setSendingReply(true)
    try {
      const base = API_ENDPOINTS.adminCompanyMailboxMessages.replace(":address", selected)
      const endpoint = composeMode ? `${base.replace("/messages", "")}/send` : `${base}/${replyTo?.id}/reply`
      const updated = await apiFetch(endpoint, {
        method: "POST",
        body: JSON.stringify({
          to: replyForm.to.trim(),
          cc: replyForm.cc.trim(),
          bcc: replyForm.bcc.trim(),
          subject: replyForm.subject.trim(),
          body: replyForm.body.trim(),
          html: markdownToHtml(replyForm.body),
          priority: replyForm.priority,
          template: replyForm.template,
        }),
      })
      if (updated?.success) {
        if (replyTo) {
          updateCurrentView(list => list.map(m => (m.id === replyTo.id ? { ...m, replied: true } : m)))
          setSelectedMessage(s => (s && s.id === replyTo.id ? { ...s, replied: true } : s))
        }
        const wasReply = !!replyTo
        setReplyTo(null)
        setComposeMode(false)
        setPreviewMode(false)
        toast({ title: wasReply ? t("replySent") : t("emailSent") })
        void loadMessages(selected, "Sent", "all", 1, "", { background: true })
      }
    } catch (e: any) {
      toast({ title: t("actionFailed", { reason: e?.message || "" }), variant: "destructive" })
    } finally {
      setSendingReply(false)
    }
  }

  const requestPurge = () => {
    const from = purgeAddress.trim()
    if (!from) return
    setConfirmState({
      title: t("purgeConfirm", { from }),
      confirmLabel: t("purge"),
      destructive: true,
      action: () => purgeMessages(from),
    })
  }

  const purgeMessages = async (from: string) => {
    setPurging(true)
    try {
      const data = await apiFetch(API_ENDPOINTS.adminCompanyMailboxPurge, {
        method: "POST",
        body: JSON.stringify({ from }),
      })
      if (data?.success) {
        setPurgeAddress("")
        setPurgeOpen(false)
        toast({ title: t("purgeQueued") })
      }
    } catch (e: any) {
      toast({ title: t("purgeFailed", { reason: e?.message || "" }), variant: "destructive" })
    } finally {
      setPurging(false)
    }
  }

  const copyText = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(label)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      // clipboard unavailable
    }
  }

  const selectedMailbox = mailboxes.find(m => m.localPart === selected)
  const viaAliasFor = (mb: MailboxInfo) =>
    !hasMailboxPerm(mb.localPart) ? mb.aliases.find(a => hasMailboxPerm(a.localPart)) : null

  const unreadBadge = (count?: number | null) =>
    count && count > 0 ? (
      <span className="flex h-4 min-w-4 items-center justify-center bg-primary/15 px-1 text-[9px] font-bold text-primary">
        {count > 99 ? "99+" : count}
      </span>
    ) : null

  const renderDetail = () => {
    if (!selectedMessage) return null
    const msg = selectedMessage
    const htmlUrl = `${API_ENDPOINTS.adminCompanyMailboxMessages.replace(":address", selected || "")}/${msg.id}/html`
    return (
      <div className="flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{msg.subject}</h3>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <AtSign className="h-3 w-3" />
              {t("from")}: {msg.fromAddress || t("unknownSender")}
            </span>
            {msg.toAddress && (
              <span className="flex items-center gap-1">
                <Send className="h-3 w-3" />
                {t("to")}: {msg.toAddress}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDate(msg.receivedAt)}
            </span>
          </div>
        </div>

        {(msg.isSpam || msg.isVirus || msg.replied) && (
          <div className="flex flex-wrap gap-1.5">
            {msg.isSpam && (
              <Badge variant="outline" className="border-warning/30 bg-warning/10 text-[10px] text-warning">
                <AlertTriangle /> {t("spam")}
              </Badge>
            )}
            {msg.isVirus && (
              <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-[10px] text-destructive">
                <Bug /> {msg.virusName || t("virus")}
              </Badge>
            )}
            {msg.replied && (
              <Badge variant="outline" className="border-primary/30 bg-primary/10 text-[10px] text-primary">
                <ReplyAll /> {t("replied")}
              </Badge>
            )}
          </div>
        )}

        <div className="border border-border/60 bg-background/40 p-3">
          {msg.html ? (
            <div className="flex flex-col gap-2">
              <a
                href={htmlUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="self-start text-[11px] text-primary underline-offset-2 hover:underline"
              >
                {t("viewHtml")}
              </a>
              <MarkdownBody content={msg.body || t("htmlOnlyBody")} />
            </div>
          ) : (
            <MarkdownBody content={msg.body || t("emptyBody")} />
          )}
        </div>

        {!!msg.attachments?.length && (
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Paperclip className="h-3 w-3" />
              {t("attachments", { count: msg.attachments.length })}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {msg.attachments.map((att, i) => (
                <a
                  key={`${att.url}-${i}`}
                  href={att.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="border border-border bg-secondary/30 px-2 py-1.5 text-[11px] text-foreground transition-colors hover:border-primary/30 hover:bg-secondary/60"
                >
                  {att.filename}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  if (loadingList) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-9 w-36" />
          <Skeleton className="h-9 w-44" />
        </div>
        <Skeleton className="h-12 w-full" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="hidden h-80 w-full lg:block" />
        </div>
      </div>
    )
  }

  if (mailboxes.length === 0) {
    return (
      <Empty className="border border-border bg-card">
        <EmptyMedia variant="icon">
          <Shield />
        </EmptyMedia>
        <EmptyHeader>
          <EmptyTitle className="text-sm">{t("noAccess")}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Mailbox selector */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 -mb-1">
        {mailboxes.map(mb => {
          const active = mb.localPart === selected
          const viaAlias = viaAliasFor(mb)
          return (
            <button
              key={mb.localPart}
              onClick={() => selectMailbox(mb.localPart)}
              data-telemetry="admin:mailboxes:select"
              className={cn(
                "group flex shrink-0 items-center gap-2 border px-3 py-2 text-xs font-medium transition-colors active:scale-[0.98]",
                active
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-secondary/30 text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              )}
            >
              <Mail className={cn("h-3.5 w-3.5", active ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
              <span className="max-w-[140px] truncate sm:max-w-none">{mb.email}</span>
              {unreadBadge(mb.unreadCount)}
              {viaAlias && (
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60">
                  {t("viaAlias", { alias: viaAlias.localPart })}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {selectedMailbox && (
        <>
          {/* Actions bar */}
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <Mail className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="truncate font-medium text-foreground">{selectedMailbox.email}</span>
                {selectedMailbox.aliases.length > 0 && (
                  <span className="hidden truncate text-[11px] sm:inline">
                    ({selectedMailbox.aliases.map(a => a.address).join(", ")})
                  </span>
                )}
                {!selectedMailbox.provisioned && (
                  <Badge variant="secondary" className="text-[10px]">{t("notProvisioned")}</Badge>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={openCompose} data-telemetry="admin:mailboxes:compose">
                  <Send />
                  {t("compose")}
                </Button>
                {sogoUrl && (
                  <Button size="sm" variant="outline" asChild data-telemetry="admin:mailboxes:sogo">
                    <a href={sogoUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink />
                      {t("openSogo")}
                    </a>
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => requestRotate(selectedMailbox.localPart)}
                  disabled={rotating}
                  data-telemetry="admin:mailboxes:rotate"
                >
                  {rotating ? <Loader2 className="animate-spin" /> : <KeyRound />}
                  {t("rotatePassword")}
                </Button>
                {isRootAdmin && (
                  <Button
                    size="sm"
                    variant={purgeOpen ? "destructive" : "outline"}
                    onClick={() => setPurgeOpen(o => !o)}
                    data-telemetry="admin:mailboxes:purge-toggle"
                  >
                    <Trash2 />
                    {t("purgeToggle")}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {isRootAdmin && purgeOpen && (
            <Card className="border-destructive/30 bg-destructive/5">
              <CardContent className="flex flex-wrap items-center gap-2 p-2.5">
                <span className="text-[11px] font-medium text-destructive">{t("purgeTitle")}</span>
                <Input
                  value={purgeAddress}
                  onChange={e => setPurgeAddress(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") requestPurge() }}
                  placeholder={t("purgePlaceholder")}
                  className="h-8 w-52 text-xs"
                />
                <Button size="sm" variant="destructive" onClick={requestPurge} disabled={purging || !purgeAddress.trim()}>
                  {purging ? <Loader2 className="animate-spin" /> : <Trash2 />}
                  {t("purge")}
                </Button>
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setPurgeOpen(false)}>
                  {t("purgeHide")}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Folder + filter tabs */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-1.5">
              {FOLDERS.map(f => (
                <button
                  key={f}
                  onClick={() => { setFolder(f); setSelectedMessage(null) }}
                  className={cn(
                    "flex items-center gap-1.5 border px-3 py-1.5 text-[11px] font-medium transition-colors",
                    folder === f
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-secondary/30 text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                  )}
                >
                  {t(`folder.${f}`)}
                  {f === "INBOX" && unreadBadge(selectedMailbox.unreadCount)}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {FILTERS.map(f => (
                <button
                  key={f}
                  onClick={() => { setFilter(f); setSelectedMessage(null) }}
                  className={cn(
                    "border px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                    filter === f
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-secondary/30 text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                  )}
                >
                  {t(`filter.${f}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
            {/* Message list */}
            <Card className="flex min-h-[360px] flex-col overflow-hidden lg:h-[calc(100vh-340px)]">
              <div className="flex items-center gap-2 border-b border-border/60 p-2.5">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchInput}
                    onChange={e => setSearchInput(e.target.value)}
                    placeholder={t("searchPlaceholder")}
                    className="h-8 pl-8 pr-8 text-xs"
                  />
                  {searchInput && (
                    <button
                      onClick={() => setSearchInput("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                      aria-label={t("clearSearch")}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={refreshNow}
                  disabled={refreshing}
                  title={t("refresh")}
                  data-telemetry="admin:mailboxes:refresh"
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
                </Button>
              </div>

              <div className="flex-1 overflow-y-auto max-h-[50vh] lg:max-h-none">
                {loadingMessages ? (
                  <div className="space-y-1 p-2">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="flex flex-col gap-1.5 p-2.5">
                        <Skeleton className="h-3 w-2/5" />
                        <Skeleton className="h-3 w-3/4" />
                        <Skeleton className="h-2 w-1/4" />
                      </div>
                    ))}
                  </div>
                ) : messages.length === 0 ? (
                  <Empty className="h-full border-0">
                    <EmptyMedia variant="icon">
                      <Inbox />
                    </EmptyMedia>
                    <EmptyHeader>
                      <EmptyTitle className="text-sm">{t("noMessages")}</EmptyTitle>
                      <EmptyDescription>{t("noMessagesHint")}</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  messages.map(msg => (
                    <button
                      key={msg.id}
                      onClick={() => setSelectedMessage(msg)}
                      data-telemetry="admin:mailboxes:open-message"
                      className={cn(
                        "group flex w-full items-start gap-2.5 border-b border-border/50 px-3 py-2.5 text-left transition-colors",
                        selectedMessage?.id === msg.id ? "bg-primary/10" : "hover:bg-secondary/40"
                      )}
                    >
                      <span
                        className={cn(
                          "mt-1.5 h-2 w-2 shrink-0",
                          msg.read ? "bg-transparent" : "bg-primary"
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className={cn("truncate text-xs", msg.read ? "font-normal text-foreground" : "font-semibold text-foreground")}>
                            {msg.fromAddress || t("unknownSender")}
                          </p>
                          <span className="shrink-0 text-[10px] text-muted-foreground/70">{formatDate(msg.receivedAt)}</span>
                        </div>
                        <p className="mt-0.5 truncate text-[11px] font-medium text-foreground">{msg.subject}</p>
                        <div className="mt-1 flex items-center gap-1.5">
                          {msg.isSpam && (
                            <span className="flex items-center gap-0.5 text-[9px] text-warning">
                              <AlertTriangle className="h-2.5 w-2.5" /> {t("spam")}
                            </span>
                          )}
                          {msg.isVirus && (
                            <span className="flex items-center gap-0.5 text-[9px] text-destructive">
                              <Bug className="h-2.5 w-2.5" /> {t("virus")}
                            </span>
                          )}
                          {msg.replied && (
                            <span className="flex items-center gap-0.5 text-[9px] text-primary">
                              <ReplyAll className="h-2.5 w-2.5" /> {t("replied")}
                            </span>
                          )}
                          {!!msg.attachments?.length && (
                            <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground">
                              <Paperclip className="h-2.5 w-2.5" /> {msg.attachments.length}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between gap-2 border-t border-border/60 p-2 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  {refreshing && <Loader2 className="h-3 w-3 animate-spin" />}
                  {t("total", { count: total })}
                </span>
                <span className="hidden sm:inline">
                  {lastUpdated ? t("lastUpdated", { time: lastUpdated }) : ""}
                </span>
                <div className="flex items-center gap-1">
                  <Button size="icon-sm" variant="ghost" onClick={() => goToPage(Math.max(1, page - 1))} disabled={page <= 1} title={t("prevPage")}>
                    <ArrowLeft />
                  </Button>
                  <span className="min-w-[2ch] text-center tabular-nums">{page}</span>
                  <Button size="icon-sm" variant="ghost" onClick={() => goToPage(page + 1)} disabled={page * limit >= total} title={t("nextPage")}>
                    <ArrowRight />
                  </Button>
                </div>
              </div>
            </Card>

            {/* Desktop detail pane */}
            <Card className="hidden min-h-[360px] flex-col overflow-hidden lg:flex lg:h-[calc(100vh-340px)]">
              {selectedMessage ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 p-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-foreground">{selectedMessage.subject}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{selectedMessage.fromAddress || t("unknownSender")}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {folder !== "Trash" && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => openReply(selectedMessage)}
                          title={t("reply")}
                          data-telemetry="admin:mailboxes:reply"
                        >
                          <Reply />
                        </Button>
                      )}
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => setMessageRead(selectedMessage, !selectedMessage.read)}
                        disabled={actionBusy}
                        title={selectedMessage.read ? t("markUnread") : t("markRead")}
                        data-telemetry="admin:mailboxes:read-toggle"
                      >
                        <CheckCheck />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="text-destructive hover:bg-destructive/10"
                        onClick={() => requestDelete(selectedMessage)}
                        disabled={actionBusy}
                        title={selectedMessage.folder === "Trash" ? t("deleteForever") : t("delete")}
                        data-telemetry="admin:mailboxes:delete"
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4">{renderDetail()}</div>
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center">
                  <Empty className="border-0">
                    <EmptyMedia variant="icon">
                      <Inbox />
                    </EmptyMedia>
                    <EmptyHeader>
                      <EmptyTitle className="text-sm">{t("selectMessage")}</EmptyTitle>
                    </EmptyHeader>
                  </Empty>
                </div>
              )}
            </Card>
          </div>
        </>
      )}

      {/* Mobile message detail (bottom sheet) */}
      {selectedMessage && (
        <div className="fixed inset-0 z-[70] lg:hidden">
          <div className="absolute inset-0 bg-background/70 backdrop-blur-sm" onClick={() => setSelectedMessage(null)} />
          <div className="absolute inset-x-0 bottom-0 top-12 flex flex-col overflow-hidden border-t border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between gap-2 border-b border-border/60 p-2.5">
              <Button size="sm" variant="ghost" onClick={() => setSelectedMessage(null)}>
                <ArrowLeft />
                {t("backToMessages")}
              </Button>
              <div className="flex items-center gap-1.5">
                {folder !== "Trash" && (
                  <Button size="icon-sm" variant="ghost" onClick={() => openReply(selectedMessage)} title={t("reply")} data-telemetry="admin:mailboxes:reply-mobile">
                    <Reply />
                  </Button>
                )}
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setMessageRead(selectedMessage, !selectedMessage.read)}
                  disabled={actionBusy}
                  title={selectedMessage.read ? t("markUnread") : t("markRead")}
                  data-telemetry="admin:mailboxes:read-toggle-mobile"
                >
                  <CheckCheck />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="text-destructive hover:bg-destructive/10"
                  onClick={() => requestDelete(selectedMessage)}
                  disabled={actionBusy}
                  title={selectedMessage.folder === "Trash" ? t("deleteForever") : t("delete")}
                  data-telemetry="admin:mailboxes:delete-mobile"
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4">{renderDetail()}</div>
          </div>
        </div>
      )}

      {/* Reply/compose modal */}
      <Dialog open={!!(replyTo || composeMode)} onOpenChange={open => { if (!open) closeComposer() }}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              {composeMode ? <MessageSquarePlus className="h-4 w-4 text-primary" /> : <Reply className="h-4 w-4 text-primary" />}
              {composeMode
                ? t("composeTitle", { mailbox: selectedMailbox?.email || "" })
                : t("replyTitle", { mailbox: selectedMailbox?.email || "" })}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <label className="w-14 shrink-0 text-[11px] text-muted-foreground">{t("from")}</label>
              <Input
                value={selectedMailbox?.email || ""}
                readOnly
                className="h-8 text-xs text-muted-foreground"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="w-14 shrink-0 text-[11px] text-muted-foreground">{t("to")}</label>
              <Input
                value={replyForm.to}
                onChange={e => setReplyForm(prev => ({ ...prev, to: e.target.value }))}
                className="h-8 text-xs"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="w-14 shrink-0 text-[11px] text-muted-foreground">{t("cc")}</label>
              <Input
                value={replyForm.cc}
                onChange={e => setReplyForm(prev => ({ ...prev, cc: e.target.value }))}
                placeholder={t("optionalField")}
                className="h-8 text-xs"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="w-14 shrink-0 text-[11px] text-muted-foreground">{t("bcc")}</label>
              <Input
                value={replyForm.bcc}
                onChange={e => setReplyForm(prev => ({ ...prev, bcc: e.target.value }))}
                placeholder={t("optionalField")}
                className="h-8 text-xs"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="w-14 shrink-0 text-[11px] text-muted-foreground">{t("subject")}</label>
              <Input
                value={replyForm.subject}
                onChange={e => setReplyForm(prev => ({ ...prev, subject: e.target.value }))}
                className="h-8 flex-1 text-xs"
              />
              <select
                value={replyForm.priority}
                onChange={e => setReplyForm(prev => ({ ...prev, priority: e.target.value }))}
                className="h-8 cursor-pointer border border-input bg-background px-2 text-xs text-foreground outline-none"
              >
                <option value="low">{t("priority.low")}</option>
                <option value="normal">{t("priority.normal")}</option>
                <option value="high">{t("priority.high")}</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="w-14 shrink-0 text-[11px] text-muted-foreground">{t("template")}</label>
              <select
                value={replyForm.template}
                onChange={e => setReplyForm(prev => ({ ...prev, template: e.target.value }))}
                className="h-8 flex-1 cursor-pointer border border-input bg-background px-2 text-xs text-foreground outline-none"
              >
                <option value="plain">{t("template.plain")}</option>
                <option value="notification">{t("template.notification")}</option>
              </select>
            </div>

            {/* Simple editor */}
            <div className="overflow-hidden border border-input">
              <div className="flex items-center gap-0.5 border-b border-border/50 bg-secondary/20 px-1.5 py-1">
                <button
                  onClick={() => insertMarkdown("**", "**", "bold text")}
                  title={t("editor.bold")}
                  className="px-1.5 py-0.5 text-[11px] font-bold text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                >
                  B
                </button>
                <button
                  onClick={() => insertMarkdown("*", "*", "italic text")}
                  title={t("editor.italic")}
                  className="px-1.5 py-0.5 text-[11px] italic text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                >
                  I
                </button>
                <button
                  onClick={() => insertMarkdown("~~", "~~", "strikethrough")}
                  title={t("editor.strike")}
                  className="px-1.5 py-0.5 text-[11px] line-through text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                >
                  S
                </button>
                <button
                  onClick={() => insertMarkdown("[", "](https://)", "link text")}
                  title={t("editor.link")}
                  className="px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                >
                  🔗
                </button>
                <button
                  onClick={() => insertMarkdown("`", "`", "code")}
                  title={t("editor.code")}
                  className="px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                >
                  {"</>"}
                </button>
                <button
                  onClick={() => insertMarkdown("\n- ", "", "list item")}
                  title={t("editor.list")}
                  className="px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                >
                  ••
                </button>
                <span className="flex-1" />
                <button
                  onClick={togglePreview}
                  disabled={loadingPreview}
                  className={cn(
                    "border px-2 py-0.5 text-[10px] font-medium transition-colors disabled:opacity-50",
                    previewMode
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-secondary"
                  )}
                >
                  {loadingPreview ? t("editor.loading") : (previewMode ? t("editor.edit") : t("editor.preview"))}
                </button>
              </div>
              {previewMode ? (
                <div className="max-h-[45vh] overflow-y-auto">
                  {previewMeta && (
                    <div className="space-y-0.5 border-b border-border/50 bg-secondary/20 px-2.5 py-1.5 text-[10px] text-muted-foreground">
                      <p>{t("from")}: {previewMeta.from}</p>
                      {previewMeta.subject && <p>{t("subject")}: {previewMeta.subject}</p>}
                    </div>
                  )}
                  <iframe
                    srcDoc={previewHtml}
                    title={t("editor.preview")}
                    sandbox=""
                    className="h-[40vh] w-full border-0"
                  />
                </div>
              ) : (
                <textarea
                  ref={bodyRef}
                  value={replyForm.body}
                  onChange={e => setReplyForm(prev => ({ ...prev, body: e.target.value }))}
                  rows={8}
                  placeholder={t("replyPlaceholder")}
                  className="w-full resize-none bg-background/40 px-2.5 py-2 text-xs text-foreground outline-none"
                />
              )}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeComposer}>{t("cancel")}</Button>
            <Button
              onClick={sendReply}
              disabled={sendingReply || !replyForm.body.trim() || !replyForm.to.trim()}
              data-telemetry="admin:mailboxes:send"
            >
              {sendingReply ? <Loader2 className="animate-spin" /> : <Send />}
              {t("send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Credentials dialog after rotation */}
      <Dialog open={!!creds} onOpenChange={open => { if (!open) setCreds(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <KeyRound className="h-4 w-4 text-primary" />
              {t("credsTitle")}
            </DialogTitle>
            <DialogDescription>{t("credsHint")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between gap-2 border border-border bg-background/50 px-2.5 py-2">
              <span className="text-muted-foreground">{t("email")}</span>
              <span className="font-mono text-foreground">{creds?.email}</span>
            </div>
            <div className="flex items-center justify-between gap-2 border border-border bg-background/50 px-2.5 py-2">
              <span className="text-muted-foreground">{t("password")}</span>
              <span className="flex items-center gap-2">
                <span className="font-mono text-foreground">{creds?.password}</span>
                <button
                  onClick={() => creds && copyText("password", creds.password)}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={t("password")}
                >
                  {copied === "password" ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </span>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCreds(null)}>{t("close")}</Button>
            {creds?.sogoUrl && (
              <Button asChild data-telemetry="admin:mailboxes:sogo-login">
                <a href={creds.sogoUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink />
                  {t("openSogoLogin")}
                </a>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation dialog */}
      <Dialog open={!!confirmState} onOpenChange={open => { if (!open && !confirmBusy) setConfirmState(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">{confirmState?.title}</DialogTitle>
            {confirmState?.description && (
              <DialogDescription>{confirmState.description}</DialogDescription>
            )}
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmState(null)} disabled={confirmBusy}>
              {t("cancel")}
            </Button>
            <Button
              variant={confirmState?.destructive ? "destructive" : "default"}
              onClick={runConfirm}
              disabled={confirmBusy}
            >
              {confirmBusy && <Loader2 className="animate-spin" />}
              {confirmState?.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Toaster is not mounted anywhere globally, so mount it here for this tab. */}
      <Toaster />
    </div>
  )
}
