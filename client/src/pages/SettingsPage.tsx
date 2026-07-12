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
import { Mail, Settings, Eye, EyeOff, Link2, KeyRound, RefreshCw, FileText, Shield } from 'lucide-react'

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

function fmtWhen(ms: number | null): string | null {
  if (!ms) return null
  return new Date(ms).toLocaleString()
}

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

  // ─── Custom Sync URL ───────────────────────────────────────────────
  const { data: syncUrlData } = useQuery<any>({
    queryKey: ['premium'],
    queryFn: () => apiFetch('/api/premium'),
  })

  const [syncUrl, setSyncUrl] = useState('')
  if (syncUrlData && !syncUrl) setSyncUrl(syncUrlData.baseUrl)

  const setCustomUrl = useMutation({
    meta: { silenceToast: true },
    mutationFn: (url: string) =>
      apiFetch('/api/premium/set-custom-url', { method: 'POST', body: JSON.stringify({ url }) }),
    onSuccess: (newData: any) => {
      queryClient.invalidateQueries({ queryKey: ['premium'] })
      setSyncUrl((newData as any).baseUrl)
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

  const syncCatalog = syncData?.catalog
  const hasSync = syncCatalog?.appliedVersion != null

  return (
    <div>
      <PageHeader
        title="系统设置"
        description="SMTP 邮箱验证、同步源与自动检查配置"
      />

      <div className="space-y-8">

        {/* ─── SMTP 邮箱验证 ───────────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-medium mb-3">邮箱验证 SMTP</h2>
          <div className="rounded-3xl border bg-card p-5">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="flex items-center gap-2">
                <Mail className="size-4 text-muted-foreground" />
                <div>
                  <h3 className="text-sm font-medium">SMTP 配置</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {smtp?.configured
                      ? `已配置 → ${smtp.host}`
                      : '未配置，登录时将跳过邮箱验证'}
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => setShowSmtpForm(!showSmtpForm)}>
                <Settings className="size-3.5" />
                {showSmtpForm ? '收起' : '设置'}
              </Button>
            </div>

            {/* SMTP 开关：始终可操作 */}
            <div className="flex items-center justify-between py-3 border-t">
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

            {showSmtpForm && (
              <div className="space-y-3 border-t pt-4">
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
                    <Label className="text-xs">邮箱账号</Label>
                    <Input value={smtpUser} onChange={e => setSmtpUser(e.target.value)} placeholder="your@email.com" className="h-9 text-sm" />
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
                <p className="text-[10px] text-muted-foreground">
                  建议使用 SMTP 授权码而非邮箱密码。保存后将覆盖云端配置。
                </p>
              </div>
            )}
          </div>
        </section>

        {/* ─── 自动同步 ─────────────────────────────────────────────── */}
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

            {/* 自定义同步源 URL */}
            <div className="border-t pt-4 space-y-2">
              <Label className="text-xs">自定义同步源 URL</Label>
              <div className="flex gap-2">
                <Input
                  value={syncUrl}
                  onChange={e => setSyncUrl(e.target.value)}
                  placeholder="https://example.com/catalog.json"
                  className="h-9 text-sm"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  disabled={syncUrl === syncUrlData?.baseUrl}
                  onClick={() => setCustomUrl.mutate(syncUrl)}
                >
                  保存
                </Button>
              </div>
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

        {/* ─── 自动检查来源方 API 密钥 ──────────────────────────────── */}
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

        {/* ─── 管理面板端口分离 ──────────────────────────────────────── */}
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

        {/* ─── 同步源地址 ────────────────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-medium mb-3">同步源</h2>
          <div className="rounded-3xl border bg-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <Link2 className="size-4 text-muted-foreground" />
              <div>
                <h3 className="text-sm font-medium">自定义同步地址</h3>
                <p className="text-xs text-muted-foreground mt-0.5">输入自建或镜像源地址，留空则使用原项目官方源</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Input
                className="h-9 text-xs font-mono flex-1"
                placeholder="https://your-mirror.example.com"
                value={syncUrl}
                onChange={(e) => setSyncUrl(e.target.value)}
              />
              <Button size="sm" className="h-9" disabled={setCustomUrl.isPending || syncUrl === syncUrlData?.baseUrl} onClick={() => setCustomUrl.mutate(syncUrl.trim())}>
                {setCustomUrl.isPending ? '保存中…' : '保存'}
              </Button>
              <Button size="sm" variant="outline" className="h-9" disabled={setCustomUrl.isPending} onClick={() => { setSyncUrl(''); setCustomUrl.mutate('') }}>
                恢复默认
              </Button>
            </div>
          </div>
        </section>

        {/* ─── SMTP 日志 ───────────────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-medium mb-3">SMTP 日志</h2>
          <div className="rounded-3xl border bg-card p-5 space-y-4">
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
        </section>

        {/* ─── IP 登录限流 ──────────────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-medium mb-3">登录安全</h2>
          <div className="rounded-3xl border bg-card p-5 space-y-4">
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
          </div>
        </section>

        {/* ─── 页脚声明 ─────────────────────────────────────────────── */}
        <div className="text-center text-xs text-muted-foreground border-t pt-6">
          基于 freellmapi 二次开发，仓库地址{' '}
          <a
            href="https://github.com/12hgl/freellmapi"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground transition-colors"
          >
            12hgl/freellmapi
          </a>
        </div>

      </div>
    </div>
  )
}
