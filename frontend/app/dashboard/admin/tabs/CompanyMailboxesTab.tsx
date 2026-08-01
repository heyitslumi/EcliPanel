"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useTranslations } from "next-intl"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { useAuth, hasPermission } from "@/hooks/useAuth"
import { apiFetch } from "@/lib/api-client"
import { API_ENDPOINTS } from "@/lib/panel-config"
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

function MarkdownBody({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-full break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 prose-p:my-1 prose-pre:my-2 prose-pre:bg-background/50 prose-pre:border prose-pre:border-border/50 prose-pre:text-xs prose-code:text-primary prose-code:bg-primary/10 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none">
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
  const [search, setSearch] = useState("")
  const [loadingMessages, setLoadingMessages] = useState(false)
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
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  const hasMailboxPerm = useCallback(
    (localPart: string) => !!user && hasPermission(user, `admin:mailbox:${localPart}`),
    [user]
  )

  const loadMailboxes = useCallback(async () => {
    setLoadingList(true)
    try {
      const data = await apiFetch(API_ENDPOINTS.adminCompanyMailboxes)
      const list = (data?.mailboxes || [])
        .filter((m: MailboxInfo) => hasMailboxPerm(m.localPart) || m.aliases.some(a => hasMailboxPerm(a.localPart)))
      setMailboxes(list)
      setSogoUrl(data?.sogoUrl || "")
      if (!selected && list.length > 0) setSelected(list[0].localPart)
    } catch {
      setMailboxes([])
    } finally {
      setLoadingList(false)
    }
  }, [hasMailboxPerm, selected])

  const loadMessages = useCallback(
    async (localPart: string, f: Folder, flt: Filter, p = 1, q = "") => {
      setLoadingMessages(true)
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
        setMessages(data?.messages || [])
        setTotal(data?.meta?.total || 0)
        setPage(p)
        setSelectedMessage(null)
      } catch {
        setMessages([])
        setTotal(0)
      } finally {
        setLoadingMessages(false)
      }
    },
    [limit]
  )

  useEffect(() => {
    loadMailboxes()
  }, [loadMailboxes])

  useEffect(() => {
    if (selected) loadMessages(selected, folder, filter, 1, search)
  }, [selected, folder, filter, loadMessages])

  const rotatePassword = async (localPart: string) => {
    if (!confirm(t("rotateConfirm"))) return
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
    } catch (e: any) {
      alert(t("rotateFailed", { reason: e.message }))
    } finally {
      setRotating(false)
    }
  }

  const setMessageRead = async (msg: MailMessage, read: boolean) => {
    if (!selected) return
    setActionBusy(true)
    try {
      const updated = await apiFetch(
        `${API_ENDPOINTS.adminCompanyMailboxMessages.replace(":address", selected)}/${msg.id}/read`,
        { method: "POST", body: JSON.stringify({ read }) }
      )
      if (updated?.success) {
        setMessages(prev => prev.map(m => (m.id === msg.id ? { ...m, read } : m)))
        setSelectedMessage(prev => (prev && prev.id === msg.id ? { ...prev, read } : prev))
      }
    } catch (e: any) {
      alert(t("actionFailed", { reason: e.message }))
    } finally {
      setActionBusy(false)
    }
  }

  const deleteMessage = async (msg: MailMessage) => {
    if (!selected) return
    if (!confirm(msg.folder === "Trash" ? t("deleteForeverConfirm") : t("deleteConfirm"))) return
    setActionBusy(true)
    try {
      const updated = await apiFetch(
        `${API_ENDPOINTS.adminCompanyMailboxMessages.replace(":address", selected)}/${msg.id}`,
        { method: "DELETE" }
      )
      if (updated?.success) {
        if (msg.folder === "Trash") {
          setMessages(prev => prev.filter(m => m.id !== msg.id))
        } else {
          setMessages(prev => prev.map(m => (m.id === msg.id ? { ...m, folder: "Trash" } : m)))
        }
        setSelectedMessage(null)
      }
    } catch (e: any) {
      alert(t("actionFailed", { reason: e.message }))
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
        }
      )
      if (updated?.success) {
        setReplyTo(null)
        setComposeMode(false)
        if (replyTo) {
          setMessages(prev => prev.map(m => (m.id === replyTo.id ? { ...m, replied: true } : m)))
          setSelectedMessage(prev => (prev && prev.id === replyTo.id ? { ...prev, replied: true } : prev))
        }
        if (folder !== "Sent") loadMessages(selected, "Sent", "all", 1, "")
      }
    } catch (e: any) {
      alert(t("actionFailed", { reason: e.message }))
    } finally {
      setSendingReply(false)
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

  if (loadingList) {
    return (
      <div className="flex items-center justify-center p-10">
        <Loader2 className="h-5 w-5 rounded-full animate-spin text-primary" />
      </div>
    )
  }

  if (mailboxes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
        <Shield className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">{t("noAccess")}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Mailbox selector */}
      <div className="flex flex-wrap gap-2">
        {mailboxes.map(mb => {
          const active = mb.localPart === selected
          const viaAlias = !hasMailboxPerm(mb.localPart)
            ? mb.aliases.find(a => hasMailboxPerm(a.localPart))
            : null
          return (
            <button
              key={mb.localPart}
              onClick={() => setSelected(mb.localPart)}
              className={`flex items-center gap-2 border px-3 py-2 text-xs font-medium transition-colors active:scale-[0.98] ${
                active
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-secondary/30 text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              }`}
            >
              <Mail className="h-3.5 w-3.5" />
              <span>{mb.email}</span>
              {viaAlias && (
                <span className="text-[9px] uppercase tracking-wider opacity-60">
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
          <div className="flex flex-wrap items-center justify-between gap-2 border border-border bg-card p-2.5 sm:p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Mail className="h-3.5 w-3.5 text-primary" />
              <span className="font-medium text-foreground">{selectedMailbox.email}</span>
              {selectedMailbox.aliases.length > 0 && (
                <span className="hidden sm:inline">
                  {selectedMailbox.aliases.map(a => a.address).join(", ")}
                </span>
              )}
              {!selectedMailbox.provisioned && (
                <span className="text-warning">{t("notProvisioned")}</span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={openCompose}
                className="flex items-center gap-1.5 border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/20 active:scale-95 transition-all"
                data-telemetry="admin:mailboxes:compose"
              >
                <Send className="h-3 w-3" />
                {t("compose")}
              </button>
              {sogoUrl && (
                <a
                  href={sogoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 border border-border bg-secondary/40 px-2.5 py-1.5 text-[11px] font-medium text-foreground hover:bg-secondary/70 active:scale-95 transition-all"
                  data-telemetry="admin:mailboxes:sogo"
                >
                  <ExternalLink className="h-3 w-3" />
                  {t("openSogo")}
                </a>
              )}
              <button
                onClick={() => rotatePassword(selectedMailbox.localPart)}
                disabled={rotating}
                className="flex items-center gap-1.5 border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/20 active:scale-95 transition-all disabled:opacity-50"
                data-telemetry="admin:mailboxes:rotate"
              >
                {rotating ? <Loader2 className="h-3 w-3 rounded-full animate-spin" /> : <KeyRound className="h-3 w-3" />}
                {t("rotatePassword")}
              </button>
            </div>
          </div>

          {/* Folder + filter tabs */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              {FOLDERS.map(f => (
                <button
                  key={f}
                  onClick={() => setFolder(f)}
                  className={`border px-3 py-1.5 text-[11px] font-medium transition-colors ${
                    folder === f
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-secondary/30 text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                  }`}
                >
                  {t(`folder.${f}`)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              {(["all", "unread", "read", "replied", "not-replied"] as Filter[]).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                    filter === f
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-secondary/30 text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                  }`}
                >
                  {t(`filter.${f}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Message list */}
            <div className="border border-border bg-card min-h-[300px] flex flex-col">
              <div className="flex items-center gap-2 border-b border-border p-2.5">
                <div className="flex flex-1 items-center gap-1.5 border border-border/60 bg-background/60 px-2 py-1">
                  <Search className="h-3 w-3 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") loadMessages(selectedMailbox.localPart, folder, filter, 1, search) }}
                    placeholder={t("searchPlaceholder")}
                    className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
                  />
                </div>
                <button
                  onClick={() => loadMessages(selectedMailbox.localPart, folder, filter, 1, search)}
                  className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                  title={t("refresh")}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto max-h-[60vh]">
                {loadingMessages ? (
                  <div className="flex justify-center p-8">
                    <Loader2 className="h-4 w-4 rounded-full animate-spin text-primary" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 p-8 text-muted-foreground">
                    <Inbox className="h-6 w-6 opacity-40" />
                    <p className="text-xs">{t("noMessages")}</p>
                  </div>
                ) : (
                  messages.map(msg => (
                    <button
                      key={msg.id}
                      onClick={() => setSelectedMessage(msg)}
                      className={`w-full text-left border-b border-border/50 px-3 py-2.5 transition-colors ${
                        selectedMessage?.id === msg.id
                          ? "bg-primary/10"
                          : msg.read
                            ? "bg-card hover:bg-secondary/40"
                            : "bg-primary/5 hover:bg-secondary/40"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className={`text-xs truncate ${msg.read ? "font-normal text-foreground" : "font-semibold text-foreground"}`}>
                          {msg.fromAddress || t("unknownSender")}
                        </p>
                        <span className="text-[10px] text-muted-foreground/70 shrink-0">{formatDate(msg.receivedAt)}</span>
                      </div>
                      <p className="text-[11px] font-medium text-foreground truncate mt-0.5">{msg.subject}</p>
                      <div className="flex items-center gap-1.5 mt-1">
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
                    </button>
                  ))
                )}
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between border-t border-border p-2 text-[11px] text-muted-foreground">
                <span>{t("total", { count: total })}</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => loadMessages(selectedMailbox.localPart, folder, filter, Math.max(1, page - 1), search)}
                    disabled={page <= 1}
                    className="p-1 hover:bg-secondary/60 disabled:opacity-30 transition-colors"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </button>
                  <span>{page}</span>
                  <button
                    onClick={() => loadMessages(selectedMailbox.localPart, folder, filter, page + 1, search)}
                    disabled={page * limit >= total}
                    className="p-1 hover:bg-secondary/60 disabled:opacity-30 transition-colors"
                  >
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Message detail */}
            <div className="border border-border bg-card min-h-[300px]">
              {selectedMessage ? (
                <div className="p-3 sm:p-4">
                  <h3 className="text-sm font-semibold text-foreground">{selectedMessage.subject}</h3>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span>
                      {t("from")}: {selectedMessage.fromAddress || t("unknownSender")}
                    </span>
                    {selectedMessage.toAddress && <span>{t("to")}: {selectedMessage.toAddress}</span>}
                    <span>{formatDate(selectedMessage.receivedAt)}</span>
                  </div>
                  {(selectedMessage.isSpam || selectedMessage.isVirus || selectedMessage.replied) && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {selectedMessage.isSpam && (
                        <span className="flex items-center gap-1 text-[10px] text-warning border border-warning/30 bg-warning/10 px-1.5 py-0.5">
                          <AlertTriangle className="h-3 w-3" /> {t("spam")}
                        </span>
                      )}
                      {selectedMessage.isVirus && (
                        <span className="flex items-center gap-1 text-[10px] text-destructive border border-destructive/30 bg-destructive/10 px-1.5 py-0.5">
                          <Bug className="h-3 w-3" /> {selectedMessage.virusName || t("virus")}
                        </span>
                      )}
                      {selectedMessage.replied && (
                        <span className="flex items-center gap-1 text-[10px] text-primary border border-primary/30 bg-primary/10 px-1.5 py-0.5">
                          <ReplyAll className="h-3 w-3" /> {t("replied")}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="mt-3 border border-border/60 bg-background/40 p-3 max-h-[50vh] overflow-y-auto">
                    {selectedMessage.html ? (
                      <div className="flex flex-col gap-2">
                        <a
                          href={`${API_ENDPOINTS.adminCompanyMailboxMessages.replace(":address", selected)}/${selectedMessage.id}/html`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="self-start text-[11px] text-primary underline-offset-2 hover:underline"
                        >
                          {t("viewHtml")}
                        </a>
                        <MarkdownBody content={selectedMessage.body || t("htmlOnlyBody")} />
                      </div>
                    ) : (
                      <MarkdownBody content={selectedMessage.body || t("emptyBody")} />
                    )}
                  </div>

                  {!!selectedMessage.attachments?.length && (
                    <div className="mt-3">
                      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                        <Paperclip className="h-3 w-3" />
                        {t("attachments", { count: selectedMessage.attachments.length })}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedMessage.attachments.map((att, i) => (
                          <a
                            key={`${att.url}-${i}`}
                            href={att.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="border border-border bg-secondary/30 px-2 py-1.5 text-[11px] text-foreground hover:border-primary/30 hover:bg-secondary/60 transition-colors"
                          >
                            {att.filename}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
                    {folder !== "Trash" && (
                      <>
                        <button
                          onClick={() => openReply(selectedMessage)}
                          className="flex items-center gap-1.5 border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/20 active:scale-95 transition-all"
                        >
                          <Reply className="h-3 w-3" />
                          {t("reply")}
                        </button>
                        <button
                          onClick={() => setMessageRead(selectedMessage, !selectedMessage.read)}
                          disabled={actionBusy}
                          className="flex items-center gap-1.5 border border-border bg-secondary/40 px-2.5 py-1.5 text-[11px] font-medium text-foreground hover:bg-secondary/70 active:scale-95 transition-all disabled:opacity-50"
                        >
                          <CheckCheck className="h-3 w-3" />
                          {selectedMessage.read ? t("markUnread") : t("markRead")}
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => deleteMessage(selectedMessage)}
                      disabled={actionBusy}
                      className="flex items-center gap-1.5 border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-[11px] font-medium text-destructive hover:bg-destructive/20 active:scale-95 transition-all disabled:opacity-50"
                    >
                      <Trash2 className="h-3 w-3" />
                      {selectedMessage.folder === "Trash" ? t("deleteForever") : t("delete")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 p-8 text-muted-foreground">
                  <Inbox className="h-6 w-6 opacity-40" />
                  <p className="text-xs">{t("selectMessage")}</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Reply/compose modal */}
      {(replyTo || composeMode) && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-background/70 backdrop-blur-sm" onClick={() => { setReplyTo(null); setComposeMode(false) }} />
          <div className="relative w-full max-w-xl border border-border bg-card p-4 sm:p-5 max-h-[90vh] overflow-y-auto">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Reply className="h-4 w-4 text-primary" />
              {composeMode
                ? t("composeTitle", { mailbox: selectedMailbox?.email || "" })
                : t("replyTitle", { mailbox: selectedMailbox?.email || "" })}
            </h3>
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2">
                <label className="w-12 shrink-0 text-[11px] text-muted-foreground">{t("from")}</label>
                <input
                  value={selectedMailbox?.email || ""}
                  readOnly
                  className="flex-1 border border-border/60 bg-background/40 px-2.5 py-1.5 text-xs text-muted-foreground outline-none"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="w-12 shrink-0 text-[11px] text-muted-foreground">{t("to")}</label>
                <input
                  value={replyForm.to}
                  onChange={e => setReplyForm(prev => ({ ...prev, to: e.target.value }))}
                  className="flex-1 border border-border/60 bg-background/40 px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary/40"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="w-12 shrink-0 text-[11px] text-muted-foreground">{t("cc")}</label>
                <input
                  value={replyForm.cc}
                  onChange={e => setReplyForm(prev => ({ ...prev, cc: e.target.value }))}
                  placeholder={t("optionalField")}
                  className="flex-1 border border-border/60 bg-background/40 px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary/40"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="w-12 shrink-0 text-[11px] text-muted-foreground">{t("bcc")}</label>
                <input
                  value={replyForm.bcc}
                  onChange={e => setReplyForm(prev => ({ ...prev, bcc: e.target.value }))}
                  placeholder={t("optionalField")}
                  className="flex-1 border border-border/60 bg-background/40 px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary/40"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="w-12 shrink-0 text-[11px] text-muted-foreground">{t("subject")}</label>
                <input
                  value={replyForm.subject}
                  onChange={e => setReplyForm(prev => ({ ...prev, subject: e.target.value }))}
                  className="flex-1 border border-border/60 bg-background/40 px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary/40"
                />
                <select
                  value={replyForm.priority}
                  onChange={e => setReplyForm(prev => ({ ...prev, priority: e.target.value }))}
                  className="border border-border/60 bg-background/40 px-2 py-1.5 text-xs text-foreground outline-none cursor-pointer"
                >
                  <option value="low">{t("priority.low")}</option>
                  <option value="normal">{t("priority.normal")}</option>
                  <option value="high">{t("priority.high")}</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="w-12 shrink-0 text-[11px] text-muted-foreground">{t("template")}</label>
                <select
                  value={replyForm.template}
                  onChange={e => setReplyForm(prev => ({ ...prev, template: e.target.value }))}
                  className="flex-1 border border-border/60 bg-background/40 px-2 py-1.5 text-xs text-foreground outline-none cursor-pointer"
                >
                  <option value="plain">{t("template.plain")}</option>
                  <option value="notification">{t("template.notification")}</option>
                </select>
              </div>

              {/* Simple editor */}
              <div className="border border-border/60">
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
                    className={`px-2 py-0.5 text-[10px] font-medium border transition-colors ${
                      previewMode
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-secondary"
                    } disabled:opacity-50`}
                  >
                    {loadingPreview ? t("editor.loading") : (previewMode ? t("editor.edit") : t("editor.preview"))}
                  </button>
                </div>
                {previewMode ? (
                  <div className="max-h-[45vh] overflow-y-auto">
                    {previewMeta && (
                      <div className="border-b border-border/50 bg-secondary/20 px-2.5 py-1.5 text-[10px] text-muted-foreground space-y-0.5">
                        <p>{t("from")}: {previewMeta.from}</p>
                        {previewMeta.subject && <p>{t("subject")}: {previewMeta.subject}</p>}
                      </div>
                    )}
                    <iframe
                      srcDoc={previewHtml}
                      title={t("editor.preview")}
                      sandbox=""
                      className="w-full h-[40vh] border-0"
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
            <div className="mt-3 flex items-center justify-end gap-1.5">
              <button
                onClick={() => { setReplyTo(null); setComposeMode(false) }}
                className="border border-border px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-secondary/60 transition-colors"
              >
                {t("cancel")}
              </button>
              <button
                onClick={sendReply}
                disabled={sendingReply || !replyForm.body.trim() || !replyForm.to.trim()}
                className="flex items-center gap-1.5 border border-primary/30 bg-primary/10 px-3 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/20 active:scale-95 transition-all disabled:opacity-50"
              >
                {sendingReply ? <Loader2 className="h-3 w-3 rounded-full animate-spin" /> : <Send className="h-3 w-3" />}
                {t("send")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Credentials modal after rotation */}
      {creds && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-background/70 backdrop-blur-sm" onClick={() => setCreds(null)} />
          <div className="relative w-full max-w-md border border-border bg-card p-4 sm:p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <KeyRound className="h-4 w-4 text-primary" />
              {t("credsTitle")}
            </h3>
            <p className="mt-1 text-[11px] text-muted-foreground">{t("credsHint")}</p>

            <div className="mt-3 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2 border border-border bg-background/50 px-2.5 py-1.5">
                <span className="text-muted-foreground">{t("email")}</span>
                <span className="font-mono text-foreground">{creds.email}</span>
              </div>
              <div className="flex items-center justify-between gap-2 border border-border bg-background/50 px-2.5 py-1.5">
                <span className="text-muted-foreground">{t("password")}</span>
                <span className="flex items-center gap-2">
                  <span className="font-mono text-foreground">{creds.password}</span>
                  <button
                    onClick={() => copyText("password", creds.password)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {copied === "password" ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </span>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between gap-2">
              <a
                href={creds.sogoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 border border-primary/30 bg-primary/10 px-3 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/20 transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                {t("openSogoLogin")}
              </a>
              <button
                onClick={() => setCreds(null)}
                className="border border-border px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-secondary/60 transition-colors"
              >
                {t("close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}