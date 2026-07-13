import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { RefreshCw, Database } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { CardSkeleton } from '@/components/ui/skeleton'
import { toast } from '@/lib/toast'
import { useI18n } from '@/i18n'

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

export default function PremiumPage() {
  const { t } = useI18n()
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery<AutoSyncStatus>({
    queryKey: ['premium'],
    queryFn: () => apiFetch('/api/premium'),
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['premium'] })
    queryClient.invalidateQueries({ queryKey: ['models'] })
  }

  const syncNow = useMutation({
    mutationFn: () => apiFetch('/api/premium/sync', { method: 'POST' }),
    onSuccess: invalidate,
  })

  const toggleSync = useMutation({
    meta: { silenceToast: true },
    mutationFn: (enabled: boolean) =>
      apiFetch('/api/premium/toggle-sync', { method: 'POST', body: JSON.stringify({ enabled }) }),
    onSuccess: invalidate,
  })

  const toggleAutoUpdate = useMutation({
    meta: { silenceToast: true },
    mutationFn: (autoUpdate: boolean) =>
      apiFetch('/api/premium/toggle-auto-update', { method: 'POST', body: JSON.stringify({ autoUpdate }) }),
    onSuccess: invalidate,
  })

  if (isLoading || !data) {
    return (
      <div>
        <PageHeader title={t('premium.title')} description={t('premium.description')} />
        <div className="space-y-6">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    )
  }

  const { enabled, autoUpdate, baseUrl, catalog } = data
  const hasSync = catalog.appliedVersion != null

  // ─── Sync source editing ──────────────────────────────────────────
  const [syncBaseUrl, setSyncBaseUrl] = useState(baseUrl)
  const [syncApiKey, setSyncApiKey] = useState('')

  useEffect(() => {
    setSyncBaseUrl(baseUrl)
  }, [baseUrl])

  const saveSyncSource = useMutation({
    mutationFn: (body: { url: string; apiKey?: string }) =>
      apiFetch('/api/premium/set-custom-url', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      invalidate()
      toast.success('同步源已更新')
    },
    onError: () => toast.error('保存失败'),
  })

  return (
    <div>
      <PageHeader
        title={t('premium.title')}
        description={t('premium.description')}
        actions={
          <Button variant="outline" size="sm" onClick={() => syncNow.mutate()} disabled={syncNow.isPending}>
            <RefreshCw className={syncNow.isPending ? 'animate-spin' : ''} />
            {syncNow.isPending ? t('premium.syncing') : t('premium.checkForUpdates')}
          </Button>
        }
      />

      <div className="space-y-8">
        {/* 同步总开关 */}
        <section>
          <h2 className="text-sm font-medium mb-3">{t('premium.catalogFeed')}</h2>
          <div className="rounded-3xl border bg-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-2">
                <Database className="size-4 text-muted-foreground" />
                <div>
                  <h3 className="text-sm font-medium">{t('premium.syncEnabled')}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">{t('premium.syncEnabledDesc')}</p>
                </div>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={(v) => toggleSync.mutate(v)}
              />
            </div>

            {enabled && (
              <div className="mt-4 pl-6 border-l-2 border-muted space-y-3">
                {/* 自动更新子开关 */}
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h4 className="text-sm">{t('premium.autoUpdate')}</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">{t('premium.autoUpdateDesc')}</p>
                  </div>
                  <Switch
                    checked={autoUpdate}
                    onCheckedChange={(v) => toggleAutoUpdate.mutate(v)}
                  />
                </div>

                {/* 同步状态 */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="text-muted-foreground">{t('premium.status')}：</span>
                  {hasSync ? (
                    <>
                      <Badge variant="default" className="text-[10px] h-5">{t('premium.liveFeed')}</Badge>
                      <span>版本 {catalog.appliedVersion}</span>
                    </>
                  ) : (
                    <Badge variant="secondary" className="text-[10px] h-5">{t('premium.monthlySnapshot')}</Badge>
                  )}
                </div>

                {/* 同步源 */}
                <div className="space-y-3">
                  <h4 className="text-sm">{t('premium.sourceUrl')}</h4>
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <Label className="text-xs">同步源地址</Label>
                      <Input
                        value={syncBaseUrl}
                        onChange={e => setSyncBaseUrl(e.target.value)}
                        placeholder="https://api.freellmapi.co"
                        className="h-9 text-sm font-mono text-xs"
                      />
                    </div>
                    <div className="space-y-1">
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
                </div>
              </div>
            )}
          </div>
        </section>

        {/* 同步状态 */}
        <section>
          <h2 className="text-sm font-medium mb-3">{t('premium.lastSync')}</h2>
          <div className="rounded-3xl border bg-card p-5">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div className="flex items-center gap-2">
                <span className={`inline-block size-2 rounded-full ${hasSync ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
                <span className="text-sm font-medium">
                  {hasSync ? t('premium.liveFeed') : t('premium.monthlySnapshot')}
                </span>
                <Badge variant="outline" className="font-mono text-[11px]">
                  {catalog.appliedVersion ?? t('premium.bundled')}
                </Badge>
              </div>
              <span className="text-xs text-muted-foreground">
                {t('premium.lastChecked', { when: fmtWhen(catalog.lastSyncMs) ?? t('premium.never') })}
              </span>
            </div>
            {catalog.lastError && (
              <p className="text-destructive text-xs mt-3">{t('premium.lastSyncProblem', { error: catalog.lastError })}</p>
            )}
            {syncNow.isPending && (
              <p className="text-xs text-muted-foreground mt-3">{t('premium.syncingStatus')}</p>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
