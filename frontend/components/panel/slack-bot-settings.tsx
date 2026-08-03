"use client"

import { useState, useEffect } from "react"
import { apiFetch } from "@/lib/api-client"
import { API_ENDPOINTS } from "@/lib/panel-config"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useTranslations } from "next-intl"
import { GitBranch, MessageSquare, Plus, Trash2, Loader2, CheckCircle2, Bot, Power } from "lucide-react"

interface McpTool {
  name: string
  description: string
  endpoint: string
  apiKey?: string
}

interface SlackConfig {
  linked: boolean
  slackUserId?: string
  githubLogin?: string | null
  hasGithubToken?: boolean
  mcpTools?: McpTool[]
}

interface UserSlackBot {
  id: number
  name: string
  workspaceId: string | null
  workspaceName: string | null
  botUserId: string | null
  enabled: boolean
  running: boolean
  lastError: string | null
  hasBotToken: boolean
  hasAppToken: boolean
  hasSigningSecret: boolean
  createdAt: string
}

export function SlackBotSettings() {
  const t = useTranslations("settingsPage")
  const [config, setConfig] = useState<SlackConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [slackUserId, setSlackUserId] = useState("")
  const [mcpTools, setMcpTools] = useState<McpTool[]>([])
  const [newTool, setNewTool] = useState<McpTool>({ name: "", description: "", endpoint: "", apiKey: "" })
  const [bots, setBots] = useState<UserSlackBot[]>([])
  const [botName, setBotName] = useState("")
  const [botToken, setBotToken] = useState("")
  const [appToken, setAppToken] = useState("")
  const [signingSecret, setSigningSecret] = useState("")
  const [botBusy, setBotBusy] = useState(false)
  const [botError, setBotError] = useState<string | null>(null)

  useEffect(() => { fetchConfig(); fetchBots() }, [])

  async function fetchConfig() {
    try {
      const data = await apiFetch(API_ENDPOINTS.slackConfig) as SlackConfig
      setConfig(data)
      if (data.slackUserId) setSlackUserId(data.slackUserId)
      if (data.mcpTools) setMcpTools(data.mcpTools)
    } catch (err) {
      console.error("Failed to fetch Slack config:", err)
    } finally {
      setLoading(false)
    }
  }

  async function saveConfig() {
    setSaving(true)
    try {
      await apiFetch(API_ENDPOINTS.slackConfig, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slackUserId, mcpTools }),
      })
      fetchConfig()
    } catch (err) {
      console.error("Failed to save config:", err)
    } finally {
      setSaving(false)
    }
  }

  async function fetchBots() {
    try {
      const data = await apiFetch(API_ENDPOINTS.slackBots) as { bots: UserSlackBot[] }
      setBots(data?.bots || [])
    } catch (err) {
      console.error("Failed to fetch Slack bots:", err)
    }
  }

  async function createBot() {
    if (!botName.trim() || !botToken.trim() || !appToken.trim()) {
      setBotError(t("slack.requiredError"))
      return
    }
    setBotBusy(true)
    setBotError(null)
    try {
      await apiFetch(API_ENDPOINTS.slackBots, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: botName.trim(),
          botToken: botToken.trim(),
          appToken: appToken.trim(),
          signingSecret: signingSecret.trim() || undefined,
        }),
      })
      setBotName("")
      setBotToken("")
      setAppToken("")
      setSigningSecret("")
      fetchBots()
    } catch (err) {
      setBotError(err instanceof Error ? err.message : String(err))
    } finally {
      setBotBusy(false)
    }
  }

  async function toggleBot(bot: UserSlackBot) {
    try {
      await apiFetch(API_ENDPOINTS.slackBot.replace(":id", String(bot.id)), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !bot.enabled }),
      })
      fetchBots()
    } catch (err) {
      console.error("Failed to toggle bot:", err)
      setBotError(err instanceof Error ? err.message : String(err))
    }
  }

  async function deleteBot(bot: UserSlackBot) {
    if (!window.confirm(t("slack.confirmRemove", { name: bot.name }))) return
    try {
      await apiFetch(API_ENDPOINTS.slackBot.replace(":id", String(bot.id)), { method: "DELETE" })
      fetchBots()
    } catch (err) {
      console.error("Failed to delete bot:", err)
      setBotError(err instanceof Error ? err.message : String(err))
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" /> {t("slack.setupTitle")}
          </CardTitle>
          <CardDescription>
            {t.rich("slack.setupDescription", { strong: (chunks) => <strong>{chunks}</strong> })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="slack-user-id">{t("slack.userIdLabel")}</Label>
            <Input
              id="slack-user-id" name="slack-member-id" autoComplete="off" autoCorrect="off" spellCheck="false"
              value={slackUserId} onChange={(e) => setSlackUserId(e.target.value)} placeholder={t("slack.userIdPlaceholder")}
            />
            <p className="text-xs text-muted-foreground">
              {t("slack.userIdHint")}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5" /> {t("slack.githubTitle")}
          </CardTitle>
          <CardDescription>{t("slack.githubDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {config?.hasGithubToken ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <span>{t.rich("slack.linkedAs", { login: config.githubLogin || "", strong: (chunks) => <strong>{chunks}</strong> })}</span>
              </div>
              <Button variant="outline" size="sm" onClick={async () => {
                await apiFetch(API_ENDPOINTS.slackGithubUnlink, { method: "DELETE" })
                fetchConfig()
              }}>
                <Trash2 className="h-4 w-4 mr-2" /> {t("slack.unlink")}
              </Button>
            </div>
          ) : (
            <Button onClick={() => window.location.href = API_ENDPOINTS.slackGithubStart}>
              <GitBranch className="h-4 w-4 mr-2" /> {t("slack.linkGithub")}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("slack.mcpTitle")}</CardTitle>
          <CardDescription>{t("slack.mcpDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {mcpTools.map((tool, i) => (
            <div key={i} className="flex items-center justify-between p-3 border rounded-lg">
              <div>
                <div className="font-medium">{tool.name}</div>
                <div className="text-xs text-muted-foreground">{tool.endpoint}</div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setMcpTools(mcpTools.filter((_, j) => j !== i))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder={t("slack.toolName")} value={newTool.name} onChange={(e) => setNewTool({ ...newTool, name: e.target.value })} />
            <Input placeholder={t("slack.endpointUrl")} value={newTool.endpoint} onChange={(e) => setNewTool({ ...newTool, endpoint: e.target.value })} />
            <Input placeholder={t("slack.descriptionOptional")} value={newTool.description} onChange={(e) => setNewTool({ ...newTool, description: e.target.value })} className="col-span-2" />
            <Input placeholder={t("slack.apiKeyOptional")} type="password" value={newTool.apiKey} onChange={(e) => setNewTool({ ...newTool, apiKey: e.target.value })} className="col-span-2" />
          </div>
          <Button onClick={() => {
            if (!newTool.name || !newTool.endpoint) return
            setMcpTools([...mcpTools, { ...newTool }])
            setNewTool({ name: "", description: "", endpoint: "", apiKey: "" })
          }} disabled={!newTool.name || !newTool.endpoint}>
            <Plus className="h-4 w-4 mr-2" /> {t("slack.addTool")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" /> {t("slack.ownBotTitle")}
          </CardTitle>
          <CardDescription>
            {t.rich("slack.ownBotDescription", { strong: (chunks) => <strong>{chunks}</strong> })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-3 rounded-lg border bg-muted/30 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">{t("slack.howToTitle")}</p>
            <p>{t.rich("slack.step1", { strong: (chunks) => <strong>{chunks}</strong>, mono: (chunks) => <span className="font-mono">{chunks}</span> })}</p>
            <p>{t.rich("slack.step2", { strong: (chunks) => <strong>{chunks}</strong>, mono: (chunks) => <span className="font-mono">{chunks}</span> })}</p>
            <p>{t.rich("slack.step3", { strong: (chunks) => <strong>{chunks}</strong>, mono: (chunks) => <span className="font-mono">{chunks}</span> })}</p>
            <p>{t.rich("slack.step4", { strong: (chunks) => <strong>{chunks}</strong>, mono: (chunks) => <span className="font-mono">{chunks}</span> })}</p>
            <p>{t.rich("slack.step5", { strong: (chunks) => <strong>{chunks}</strong>, mono: (chunks) => <span className="font-mono">{chunks}</span> })}</p>
          </div>

          <div className="space-y-2">
            <div className="space-y-1.5">
              <Label htmlFor="bot-name">{t("slack.botNameLabel")}</Label>
              <Input id="bot-name" value={botName} onChange={(e) => setBotName(e.target.value)} placeholder={t("slack.botNamePlaceholder")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bot-token">{t("slack.botTokenLabel")}</Label>
              <Input id="bot-token" type="password" value={botToken} onChange={(e) => setBotToken(e.target.value)} placeholder={t("slack.botTokenPlaceholder")} autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="app-token">{t("slack.appTokenLabel")}</Label>
              <Input id="app-token" type="password" value={appToken} onChange={(e) => setAppToken(e.target.value)} placeholder={t("slack.appTokenPlaceholder")} autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="signing-secret">{t("slack.signingSecretLabel")}</Label>
              <Input id="signing-secret" type="password" value={signingSecret} onChange={(e) => setSigningSecret(e.target.value)} placeholder={t("slack.signingSecretPlaceholder")} autoComplete="off" />
            </div>
          </div>

          {botError && <p className="text-xs text-red-500">{botError}</p>}

          <Button onClick={createBot} disabled={botBusy} className="w-full">
            {botBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Bot className="h-4 w-4 mr-2" />}
            {t("slack.connect")}
          </Button>

          {bots.length > 0 && (
            <div className="space-y-2 pt-1">
              {bots.map((bot) => (
                <div key={bot.id} className="flex items-center justify-between gap-2 p-3 border rounded-lg">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full shrink-0 ${bot.running ? "bg-green-500" : "bg-muted-foreground"}`} />
                      <span className="font-medium truncate">{bot.name}</span>
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {bot.workspaceName || t("slack.unknownWorkspace")}
                      {" · "}{bot.enabled ? t("slack.active") : t("slack.paused")}
                    </div>
                    {bot.lastError && <div className="text-xs text-red-500 truncate">{bot.lastError}</div>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="outline" size="sm" onClick={() => toggleBot(bot)} title={bot.enabled ? t("slack.pause") : t("slack.activate")}>
                      <Power className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => deleteBot(bot)} title={t("slack.remove")}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Button onClick={saveConfig} disabled={saving} className="w-full">
        {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} {t("slack.saveConfiguration")}
      </Button>
    </div>
  )
}
