import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { toast } from '@/lib/toast'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Mail, Settings, Eye, EyeOff, RefreshCw, KeyRound, FileText, Shield, Info, ExternalLink } from 'lucide-react'

interface SmtpConfig {
  configured: boolean
  enabled: boolean
  host: string
  port: number
  user: string
  hasPass: boolean
  from: string
}

interface CatalogSyncState {
  baseUrl: string
  appliedVersion: string | null
  appliedTier: string | null
  lastSyncMs: number | null
  lastError: string | null
}

interface AutoSyncStatus {
  enabled: boolean
  autoUpdate: boolean
  baseUrl: string
  catalog: CatalogSyncState
}

interface LatestVersion {
  version: string
  changelog: string
  hasUpdate: boolean
}

function fmtWhen(ms: number | null): string | null {
  if (!ms) return null
  return new Date(ms).toLocaleString()
}

interface SmtpPreset {
  label: string
  host: string
  port: number
  tls: boolean
}

const SMTP_PRESETS: SmtpPreset[] = [
  { label: 'Gmail', host: 'smtp.gmail.com', port: 587, tls: true },
  { label: 'QQ邮箱', host: 'smtp.qq.com', port: 587, tls: true },
  { label: '163邮箱', host: 'smtp.163.com', port: 465, tls: true },
  { label: 'Outlook', host: 'smtp-mail.outlook.com', port: 587, tls: true },
]

export default function SettingsPage() {
  const queryClient = useQueryClient()

  // ─── SMTP ──────────────────────────────────────────────────────────
  const [showSmtpForm, setShowSmtpForm] = useState(false)
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState('587')
  const [smtpUser, setSmtpUser] = useState('')
  const [smtpPass, setSmtpPass] = useState('')
  const [smtpFrom, setSmtpFrom] = useState('')
  const [showPass, setShowPass] = useState(false)

  const { data: smtp } = useQuery<SmtpConfig>({
    queryKey: ['smtp-config'],
    queryFn: () => apiFetch('/api/smtp/config'),
  })

  useEffect(() => {
    if (smtp && showSmtpForm) {
      setSmtpHost(smtp.host)
      setSmtpPort(String(smtp.port || 587))
      setSmtpUser(smtp.user)
      setSmtpFrom(smtp.from)
    }
  }, [smtp, showSmtpForm])

  const saveSmtp = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch('/api/smtp/config', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smtp-config'] })
      toast.success('操作成功！')
    },
  })

  const toggleSmtp = useMutation({
    mutationFn: (enabled: boolean) =>
      apiFetch('/api/smtp/config', { method: 'POST', body: JSON.stringify({ enabled }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smtp-config'] })
      toast.success('操作成功！')
    },
  })

  const applyPreset = (preset: SmtpPreset) => {
    setSmtpHost(preset.host)
    setSmtpPort(String(preset.port))
    setSelectedProvider(preset.label)
    if (!showSmtpForm) setShowSmtpForm(true)
  }

  // ─── Sync Source ──────────────────────────────────────────────────
  const [syncBaseUrl, setSyncBaseUrl] = useState('')
  const [syncApiKey, setSyncApiKey] = useState('')

  useEffect(() => {
    if (syncData?.baseUrl) setSyncBaseUrl(syncData.baseUrl)
  }, [syncData?.baseUrl])

  const saveSyncSource = useMutation({
    mutationFn: (body: { url: string; apiKey?: string }) =>
      apiFetch('/api/premium/set-custom-url', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['premium'] })
      toast.success('同步源已更新')
    },
    onError: () => toast.error('保存失败'),
  })

  // ─── Admin Port Separation ─────────────────────────────────────────
  const { data: adminPortData } = useQuery<{ enabled: boolean }>({
    queryKey: ['admin-port-separation'],
    queryFn: () => apiFetch('/api/settings/admin-port-separation'),
  })

  const toggleAdminPort = useMutation({
    mutationFn: (enabled: boolean) =>
      apiFetch('/api/settings/admin-port-separation', { method: 'POST', body: JSON.stringify({ enabled }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-port-separation'] })
      toast.success('操作成功！')
    },
  })

  // ─── Auto-Sync ─────────────────────────────────────────────────────
  const { data: syncData } = useQuery<AutoSyncStatus>({
    queryKey: ['premium'],
    queryFn: () => apiFetch('/api/premium'),
  })

  // ─── Auto-Sync Mutations ───────────────────────────────────────────
  const toggleSync = useMutation({
    mutationFn: (enabled: boolean) =>
      apiFetch('/api/premium/toggle-sync', { method: 'POST', body: JSON.stringify({ enabled }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['premium'] })
      toast.success('操作成功！')
    },
  })

  const toggleAutoUpdate = useMutation({
    mutationFn: (autoUpdate: boolean) =>
      apiFetch('/api/premium/toggle-auto-update', { method: 'POST', body: JSON.stringify({ autoUpdate }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['premium'] })
      toast.success('操作成功！')
    },
  })

  const syncNow = useMutation({
    mutationFn: () => apiFetch('/api/premium/sync', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['premium'] })
      toast.success('同步完成！')
    },
    onError: () => {
      toast.error('同步失败')
    },
  })

  // ─── Auto-Check Source API Keys ────────────────────────────────────
  const { data: keyCheckData } = useQuery<{ enabled: boolean }>({
    queryKey: ['api-key-check'],
    queryFn: () => apiFetch('/api/settings/api-key-check'),
  })

  const toggleKeyCheck = useMutation({
    mutationFn: (enabled: boolean) =>
      apiFetch('/api/settings/api-key-check', { method: 'POST', body: JSON.stringify({ enabled }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-key-check'] })
      toast.success('操作成功！')
    },
  })

  // ─── SMTP Log ──────────────────────────────────────────────────────
  const { data: smtpLogData } = useQuery<{ enabled: boolean; showCode: boolean }>({
    queryKey: ['smtp-log'],
    queryFn: () => apiFetch('/api/settings/smtp-log'),
  })

  const toggleSmtpLog = useMutation({
    mutationFn: (enabled: boolean) =>
      apiFetch('/api/settings/smtp-log', { method: 'PUT', body: JSON.stringify({ enabled }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smtp-log'] })
      toast.success('操作成功！')
    },
  })

  const toggleSmtpLogCode = useMutation({
    mutationFn: (showCode: boolean) =>
      apiFetch('/api/settings/smtp-log', { method: 'PUT', body: JSON.stringify({ showCode }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smtp-log'] })
      toast.success('操作成功！')
    },
  })

  // ─── IP Rate Limiter ───────────────────────────────────────────────
  interface IpLimitConfig {
    enabled: boolean
    threshold: number
    duration: number
  }

  const { data: ipLimitData } = useQuery<IpLimitConfig>({
    queryKey: ['ip-limit'],
    queryFn: () => apiFetch('/api/settings/ip-limit'),
  })

  const [ipThreshold, setIpThreshold] = useState('5')
  const [ipDuration, setIpDuration] = useState('180')
  useEffect(() => {
    if (ipLimitData) {
      setIpThreshold(String(ipLimitData.threshold))
      setIpDuration(String(ipLimitData.duration))
    }
  }, [ipLimitData])

  const saveIpLimit = useMutation({
    mutationFn: (body: { enabled?: boolean; threshold?: number; duration?: number }) =>
      apiFetch('/api/settings/ip-limit', { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ip-limit'] })
      toast.success('操作成功！')
    },
  })

  // ─── Latest Version ────────────────────────────────────────────────
  const { data: latestVersion } = useQuery<LatestVersion>({
    queryKey: ['latest-version'],
    queryFn: () => apiFetch('/api/settings/latest-version'),
  })

  const currentVersion = '1.17'
  const hasUpdate = latestVersion?.hasUpdate ?? false

  // ─── Outlook OAuth ────────────────────────────────────────────────
  const [oauthOutlookAuthorized, setOauthOutlookAuthorized] = useState(false)
  const [oauthChecking, setOauthChecking] = useState(false)

  useEffect(() => {
    // Check Outlook OAuth status on mount
    apiFetch('/api/oauth/microsoft/status')
      .then((d: any) => setOauthOutlookAuthorized(d?.authorized ?? false))
      .catch(() => {})
  }, [])

  const startMicrosoftOAuth = () => {
    apiFetch('/api/oauth/microsoft/auth')
      .then((data: any) => {
        if (data?.url) {
          window.open(data.url, 'MicrosoftOAuth', 'width=600,height=700')
        }
      })
      .catch(() => toast.error('无法启动 OAuth 授权'))
  }

  const revokeMicrosoftOAuth = () => {
    apiFetch('/api/oauth/microsoft/revoke', { method: 'POST' })
      .then(() => {
        setOauthOutlookAuthorized(false)
        toast.success('已撤销 Outlook OAuth 授权')
      })
      .catch(() => toast.error('撤销授权失败'))
  }

  // OAuth status polling after window opens
  useEffect(() => {
    if (!oauthOutlookAuthorized) {
      const interval = setInterval(() => {
        setOauthChecking(true)
        apiFetch('/api/oauth/microsoft/status')
          .then((d: any) => {
            if (d?.authorized) {
              setOauthOutlookAuthorized(true)
              setOauthChecking(false)
              toast.success('Outlook OAuth 授权成功')
            }
          })
          .catch(() => setOauthChecking(false))
      }, 3000)
      return () => clearInterval(interval)
    }
  }, [oauthOutlookAuthorized])

  // ─── SMTP Provider Selection ───────────────────────────────────────
  const smtpProviders = ['Gmail', 'Outlook', 'QQ邮箱', '126邮箱', '163邮箱', 'Gmail (授权码)', '自定义']
  const [selectedProvider, setSelectedProvider] = useState('')

  const syncCatalog = syncData?.catalog
  const hasSync = syncCatalog?.appliedVersion != null

  return (
    <div>
      <PageHeader
        title="系统设置"
        description="邮件通知、版本更新与自动同步配置"
      />

      <div className="space-y-8">

        {/* ─── 登录安全 ─────────────────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-medium mb-3">登录安全</h2>
          <div className="rounded-3xl border bg-card p-5 space-y-4">

            {/* IP 登录限流 */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="size-4 text-muted-foreground" />
                <div>
                  <h3 className="text-sm font-medium">IP 登录限流</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">同一 IP 连续登录失败达到阈值后临时封禁</p>
                </div>
              </div>
              <Switch
                checked={ipLimitData?.enabled ?? false}
                onCheckedChange={(v) => saveIpLimit.mutate({ enabled: v })}
                disabled={saveIpLimit.isPending}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t pt-4">
              <div className="space-y-1.5">
                <Label className="text-xs">失败次数阈值</Label>
                <Input
                  type="number"
                  min="1"
                  value={ipThreshold}
                  onChange={e => setIpThreshold(e.target.value)}
                  className="h-9 text-sm"
                />
                <p className="text-[10px] text-muted-foreground">连续失败超过此次数后封禁 IP</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">封禁时长（秒）</Label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    min="1"
                    value={ipDuration}
                    onChange={e => setIpDuration(e.target.value)}
                    className="h-9 text-sm"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 h-9"
                    disabled={saveIpLimit.isPending}
                    onClick={() => saveIpLimit.mutate({
                      threshold: parseInt(ipThreshold, 10) || 5,
                      duration: parseInt(ipDuration, 10) || 180,
                    })}
                  >
                    保存
                  </Button>
                </div>
              </div>
            </div>

            {/* 登录邮箱验证（集成到登录安全） */}
            <div className="flex items-center justify-between border-t pt-4">
              <div>
                <h4 className="text-sm font-medium">登录时启用邮箱验证</h4>
                <p className="text-xs text-muted-foreground">关闭后即使 SMTP 已配置也不会在登录时发送验证码</p>
              </div>
              <Switch
                checked={smtp?.enabled ?? false}
                onCheckedChange={(v) => toggleSmtp.mutate(v)}
                disabled={toggleSmtp.isPending}
              />
            </div>

          </div>
        </section>

        {/* ─── 邮件通知服务 ─────────────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-medium mb-3">邮件通知服务</h2>
          <div className="rounded-3xl border bg-card p-5">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="flex items-center gap-2">
                <Mail className="size-4 text-muted-foreground" />
                <div>
                  <h3 className="text-sm font-medium">SMTP 配置</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    系统将通过指定的SMTP服务发送账号安全邮件（如登录验证码、密码重置等）
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {smtp?.configured
                      ? `当前已配置 → ${smtp.host}`
                      : '未配置，登录时将跳过邮箱验证'}
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => setShowSmtpForm(!showSmtpForm)}>
                <Settings className="size-3.5" />
                {showSmtpForm ? '收起' : '设置'}
              </Button>
            </div>

            {/* 服务商选择 */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="text-[11px] text-muted-foreground">服务商：</span>
              {smtpProviders.map(prov => (
                <Button
                  key={prov}
                  variant={selectedProvider === prov ? 'default' : 'outline'}
                  size="xs"
                  className="h-7 text-[11px]"
                  onClick={() => {
                    setSelectedProvider(prov)
                    if (!showSmtpForm) setShowSmtpForm(true)
                    if (prov === 'Gmail') applyPreset(SMTP_PRESETS[0])
                    else if (prov === 'Outlook') applyPreset(SMTP_PRESETS[3])
                    else if (prov === 'QQ邮箱') applyPreset(SMTP_PRESETS[1])
                    else if (prov === '163邮箱') applyPreset(SMTP_PRESETS[2])
                    else if (prov === '126邮箱') { setSmtpHost('smtp.126.com'); setSmtpPort('994') }
                    else if (prov === 'Gmail (授权码)') { setSmtpHost('smtp.gmail.com'); setSmtpPort('587') }
                  }}
                >
                  {prov}
                </Button>
              ))}
            </div>

            {showSmtpForm && (
              <div className="space-y-3 border-t pt-4">
                {/* Outlook / Gmail OAuth 授权 */}
                {selectedProvider === 'Outlook' && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Outlook OAuth 授权</Label>
                    <div className="flex items-center gap-2">
                      <span className="text-sm flex-1 px-3 py-1.5 bg-muted rounded-md border">
                        {oauthOutlookAuthorized ? '已授权' : (oauthChecking ? '检测中…' : '未授权')}
                      </span>
                      {oauthOutlookAuthorized ? (
                        <Button variant="outline" size="sm" className="h-9" onClick={revokeMicrosoftOAuth}>
                          撤销授权
                        </Button>
                      ) : (
                        <Button size="sm" className="h-9" onClick={startMicrosoftOAuth}>
                          去授权
                        </Button>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Outlook 使用 Microsoft OAuth API 授权，无需输入密码。点击「去授权」后将弹出 Microsoft 登录窗口。
                    </p>
                  </div>
                )}

                {/* SMTP 表单（非 Outlook 时显示） */}
                {selectedProvider !== 'Outlook' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">SMTP 服务器</Label>
                      <Input value={smtpHost} onChange={e => setSmtpHost(e.target.value)} placeholder="smtp.gmail.com" className="h-9 text-sm" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">端口</Label>
                      <Input value={smtpPort} onChange={e => setSmtpPort(e.target.value)} placeholder="587" className="h-9 text-sm" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">邮箱地址</Label>
                      <div className="relative">
                        <Input value={smtpUser} onChange={e => setSmtpUser(e.target.value)} placeholder="your@email.com" className="h-9 text-sm pr-12" />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">{smtpUser.length}/50</span>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">邮箱密码 / 授权码</Label>
                      <div className="relative">
                        <Input
                          type={showPass ? 'text' : 'password'}
                          value={smtpPass}
                          onChange={e => setSmtpPass(e.target.value)}
                          placeholder={smtp?.hasPass ? '•••••••• (留空不变)' : '输入邮箱授权码'}
                          className="h-9 text-sm pr-9"
                        />
                        <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                          {showPass ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">发件人显示名（可选）</Label>
                      <Input value={smtpFrom} onChange={e => setSmtpFrom(e.target.value)} placeholder="FreeLLMAPI" className="h-9 text-sm" />
                    </div>
                    <div className="flex items-end">
                      <Button size="sm" onClick={() => saveSmtp.mutate({ host: smtpHost.trim(), port: parseInt(smtpPort, 10) || 587, user: smtpUser.trim(), pass: smtpPass, from: smtpFrom.trim() })} disabled={saveSmtp.isPending} className="w-full h-9">
                        {saveSmtp.isPending ? '保存中…' : '保存设置'}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Outlook 额外说明 */}
                {selectedProvider === 'Outlook' && (
                  <div className="border-t pt-3 mt-3">
                    <p className="text-[10px] text-muted-foreground">
                      OAuth 授权后将自动配置 SMTP 服务器为 smtp-mail.outlook.com。保存设置后会覆盖云端配置。
                    </p>
                    <div className="flex gap-2 mt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        onClick={() => saveSmtp.mutate({ host: 'smtp-mail.outlook.com', port: 587, user: smtpUser.trim(), pass: smtpPass, from: smtpFrom.trim() })}
                        disabled={saveSmtp.isPending}
                      >
                        {saveSmtp.isPending ? '保存中…' : '保存设置'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* SMTP 日志（集成到邮件通知服务内） */}
            <div className="border-t mt-4 pt-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="size-4 text-muted-foreground" />
                  <div>
                    <h3 className="text-sm font-medium">启用 SMTP 发送日志</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">在服务端控制台输出邮件发送过程日志</p>
                  </div>
                </div>
                <Switch
                  checked={smtpLogData?.enabled ?? false}
                  onCheckedChange={(v) => toggleSmtpLog.mutate(v)}
                  disabled={toggleSmtpLog.isPending}
                />
              </div>
              <div className="flex items-center justify-between border-t pt-4">
                <div>
                  <h3 className="text-sm font-medium">在日志中显示验证码</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">开启后验证码将明文出现在日志中（调试用）</p>
                </div>
                <Switch
                  checked={smtpLogData?.showCode ?? false}
                  onCheckedChange={(v) => toggleSmtpLogCode.mutate(v)}
                  disabled={toggleSmtpLogCode.isPending}
                />
              </div>
            </div>
          </div>
        </section>

        {/* ─── 版本更新 ──────────────────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-medium mb-3">版本更新</h2>
          <div className="rounded-3xl border bg-card p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Info className="size-4 text-muted-foreground" />
                <div>
                  <h3 className="text-sm font-medium">当前版本</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    便于辨别版本与检查更新
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="font-mono text-xs">
                  v{currentVersion}
                </Badge>
                {hasUpdate ? (
                  <Badge className="font-mono text-xs bg-amber-500 text-white">
                    新版本 v{latestVersion?.version}
                  </Badge>
                ) : (
                  <span className="text-xs text-emerald-600">已是最新版本</span>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => {
                    queryClient.invalidateQueries({ queryKey: ['latest-version'] })
                    toast.success('已检查更新')
                  }}
                >
                  <RefreshCw className="size-3 mr-1" />
                  检查更新
                </Button>
              </div>
            </div>
            {latestVersion?.changelog && (
              <div className="border-t mt-4 pt-4">
                <p className="text-xs text-muted-foreground whitespace-pre-wrap">{latestVersion.changelog}</p>
              </div>
            )}
          </div>
        </section>

        {/* ─── 自动同步 ──────────────────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-medium mb-3">自动同步</h2>
          <div className="rounded-3xl border bg-card p-5 space-y-4">

            {/* 自动同步开关 */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-2">
                <RefreshCw className="size-4 text-muted-foreground mt-0.5" />
                <div>
                  <h3 className="text-sm font-medium">启用自动同步</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">定时从同步源拉取最新数据更新</p>
                </div>
              </div>
              <Switch
                checked={syncData?.enabled ?? false}
                onCheckedChange={(v) => toggleSync.mutate(v)}
                disabled={toggleSync.isPending}
              />
            </div>

            {/* 同步源 URL 配置 */}
            <div className="border-t pt-4 space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">同步源地址</Label>
                <Input
                  value={syncBaseUrl}
                  onChange={e => setSyncBaseUrl(e.target.value)}
                  placeholder="https://api.freellmapi.co"
                  className="h-9 text-sm font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">API KEY（可选）</Label>
                <Input
                  value={syncApiKey}
                  onChange={e => setSyncApiKey(e.target.value)}
                  placeholder="用于认证同步源的 API 密钥"
                  className="h-9 text-sm"
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                disabled={saveSyncSource.isPending}
                onClick={() => saveSyncSource.mutate({ url: syncBaseUrl.trim(), apiKey: syncApiKey.trim() || undefined })}
              >
                {saveSyncSource.isPending ? '保存中…' : '保存同步源'}
              </Button>
            </div>

            {/* 自动更新开关 */}
            <div className="flex items-start justify-between gap-4 border-t pt-4">
              <div className="flex items-center gap-2">
                <RefreshCw className="size-4 text-muted-foreground mt-0.5" />
                <div>
                  <h3 className="text-sm font-medium">自动应用更新</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">同步后自动应用最新数据，否则仅提醒</p>
                </div>
              </div>
              <Switch
                checked={syncData?.autoUpdate !== false}
                onCheckedChange={(v) => toggleAutoUpdate.mutate(v)}
                disabled={toggleAutoUpdate.isPending}
              />
            </div>

            {/* 立即同步按钮 + 状态 */}
            <div className="border-t pt-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className={`inline-block size-2 rounded-full ${hasSync ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
                <span className="text-sm font-medium">
                  {hasSync ? '实时源' : '月度快照'}
                </span>
                <Badge variant="outline" className="font-mono text-[11px]">
                  {syncCatalog?.appliedVersion ?? '内置'}
                </Badge>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  上次检查：{fmtWhen(syncCatalog?.lastSyncMs ?? null) ?? '从未'}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={syncNow.isPending}
                  onClick={() => syncNow.mutate()}
                >
                  {syncNow.isPending ? '同步中…' : '立即同步'}
                </Button>
              </div>
            </div>

            {syncCatalog?.lastError && (
              <p className="text-destructive text-xs border-t pt-3">{syncCatalog.lastError}</p>
            )}
          </div>
        </section>

        {/* ─── 密钥检查 ──────────────────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-medium mb-3">密钥检查</h2>
          <div className="rounded-3xl border bg-card p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="size-4 text-muted-foreground" />
                <div>
                  <h3 className="text-sm font-medium">自动检查来源方 API 密钥</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">每天自动检查已配置的提供商 API 密钥是否仍然有效</p>
                </div>
              </div>
              <Switch
                checked={keyCheckData?.enabled ?? false}
                onCheckedChange={(v) => toggleKeyCheck.mutate(v)}
                disabled={toggleKeyCheck.isPending}
              />
            </div>
          </div>
        </section>

        {/* ─── 端口分离 ──────────────────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-medium mb-3">端口分离</h2>
          <div className="rounded-3xl border bg-card p-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium">分离管理面板端口</h3>
                <p className="text-xs text-muted-foreground mt-0.5">将管理面板前端独立到容器 3002 端口，API 保持在 3001</p>
              </div>
              <Switch
                checked={adminPortData?.enabled ?? false}
                onCheckedChange={(v) => toggleAdminPort.mutate(v)}
                disabled={toggleAdminPort.isPending}
              />
            </div>
            {toggleAdminPort.isSuccess && (
              <p className="text-xs text-amber-500 mt-2">更改已保存，重启容器后生效</p>
            )}
          </div>
        </section>

        {/* ─── 关于 ──────────────────────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-medium mb-3">关于</h2>
          <div className="rounded-3xl border bg-card p-5">
            <div className="text-center text-xs text-muted-foreground py-2">
              基于 freellmapi 二次开发，仓库地址{' '}
              <a
                href="https://github.com/12hgl/freellmapi"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground transition-colors inline-flex items-center gap-1"
              >
                12hgl/freellmapi
                <ExternalLink className="size-3" />
              </a>
            </div>
            <div className="text-center text-xs text-muted-foreground mt-1">
              当前版本：v{currentVersion}
            </div>
          </div>
        </section>

      </div>
    </div>
  )
}
