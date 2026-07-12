import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/page-header'
import { CopyButton } from '@/components/copy-button'
import { Plus, Trash2, Key, KeyRound } from 'lucide-react'
import { toast } from '@/lib/toast'

interface FusionKey {
  id: number
  keyValue: string
  name: string
  providerIds: string[]
  modelIds: string[]
  rateLimitRpm: number
  enabled: boolean
  createdAt: string
  lastUsedAt: string | null
  requestCount: number
}

interface FusionListResponse {
  keys: FusionKey[]
}

export default function FusionKeysPage() {
  const queryClient = useQueryClient()
  const [newName, setNewName] = useState('')
  const [newProviderIds, setNewProviderIds] = useState('freeqwq')
  const [newModelIds, setNewModelIds] = useState('*')
  const [newRateLimit, setNewRateLimit] = useState('60')
  const [creating, setCreating] = useState(false)

  const { data, isLoading } = useQuery<FusionListResponse>({
    queryKey: ['fusion-keys'],
    queryFn: () => apiFetch('/api/fusion/list'),
    refetchInterval: false,
  })

  const createMutation = useMutation({
    meta: { silenceToast: true },
    mutationFn: (body: { name: string; providerIds: string[]; modelIds: string[]; rateLimitRpm: number }) =>
      apiFetch<{ key: FusionKey }>('/api/fusion/create', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fusion-keys'] })
      setNewName('')
      setCreating(false)
      toast.success('融合 API Key 创建成功')
    },
    onError: (err) => {
      toast.error(`创建失败：${(err as Error).message}`)
      setCreating(false)
    },
  })

  const deleteMutation = useMutation({
    meta: { silenceToast: true },
    mutationFn: (id: number) => apiFetch(`/api/fusion/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fusion-keys'] })
      toast.success('融合 API Key 已删除')
    },
  })

  const toggleMutation = useMutation({
    meta: { silenceToast: true },
    mutationFn: (id: number) => apiFetch<{ enabled: boolean }>(`/api/fusion/${id}/toggle`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fusion-keys'] })
    },
  })

  const keys = data?.keys ?? []

  function handleCreate() {
    setCreating(true)
    const providers = newProviderIds.split(',').map(s => s.trim()).filter(Boolean)
    const models = newModelIds.split(',').map(s => s.trim()).filter(Boolean)
    const rpm = parseInt(newRateLimit, 10) || 60
    createMutation.mutate({
      name: newName || '未命名密钥',
      providerIds: providers.length > 0 ? providers : ['freeqwq'],
      modelIds: models.length > 0 ? models : ['*'],
      rateLimitRpm: rpm,
    })
  }

  return (
    <div>
      <PageHeader
        title="融合 API Key 管理"
        description="创建和管理可跨提供商调用的融合 API Key，用于第三方客户端接入。"
        divider={false}
      />

      {/* Create new key */}
      <div className="rounded-2xl border bg-card p-5 mb-6">
        <h2 className="text-sm font-medium mb-3 flex items-center gap-2">
          <Plus className="size-4" />
          创建新的融合 API Key
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-3">
          <div className="space-y-1.5">
            <Label className="text-xs">名称</Label>
            <Input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="我的融合密钥"
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">提供商 (逗号分隔)</Label>
            <Input
              value={newProviderIds}
              onChange={e => setNewProviderIds(e.target.value)}
              placeholder="freeqwq,ollama"
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">允许模型 (逗号分隔,*=全部)</Label>
            <Input
              value={newModelIds}
              onChange={e => setNewModelIds(e.target.value)}
              placeholder="*"
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">速率限制 (RPM)</Label>
            <Input
              type="number"
              value={newRateLimit}
              onChange={e => setNewRateLimit(e.target.value)}
              placeholder="60"
              className="h-9 text-sm"
            />
          </div>
          <div className="flex items-end">
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={creating || createMutation.isPending}
              className="w-full h-9"
            >
              {creating ? '创建中...' : '创建'}
            </Button>
          </div>
        </div>
      </div>

      {/* Key list */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground text-center py-8">加载中...</p>
      ) : keys.length === 0 ? (
        <div className="rounded-2xl border bg-card p-8 text-center">
          <KeyRound className="size-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">暂无融合 API Key</p>
          <p className="text-xs text-muted-foreground mt-1">点击上方创建按钮生成第一个融合密钥</p>
        </div>
      ) : (
        <div className="space-y-3">
          {keys.map(key => (
            <div
              key={key.id}
              className={`rounded-2xl border p-5 transition-colors ${key.enabled ? 'bg-card' : 'bg-muted/30 opacity-70'}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Key className="size-3.5 text-muted-foreground" />
                    <h3 className="text-sm font-medium truncate">{key.name}</h3>
                    {key.enabled ? (
                      <Badge variant="default" className="text-[10px] h-5">已启用</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px] h-5">已禁用</Badge>
                    )}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="text-xs font-mono bg-muted px-2 py-1 rounded-md select-all max-w-[320px] truncate inline-block">
                      {key.keyValue}
                    </code>
                    <CopyButton text={key.keyValue} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                    <span>提供商：{key.providerIds.join(', ') || '全部'}</span>
                    <span>模型：{key.modelIds.join(', ') || '全部'}</span>
                    <span>速率限制：{key.rateLimitRpm} RPM</span>
                    <span>调用次数：{key.requestCount}</span>
                    <span>创建时间：{new Date(key.createdAt).toLocaleString()}</span>
                    {key.lastUsedAt && <span>最后使用：{new Date(key.lastUsedAt).toLocaleString()}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <Switch
                    checked={key.enabled}
                    onCheckedChange={() => toggleMutation.mutate(key.id)}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      if (window.confirm(`确定要删除融合 API Key "${key.name}"？此操作不可撤销。`)) {
                        deleteMutation.mutate(key.id)
                      }
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Usage guide */}
      {keys.length > 0 && (
        <div className="mt-6 rounded-2xl border bg-muted/30 p-5">
          <h2 className="text-sm font-medium mb-2">使用方法</h2>
          <p className="text-xs text-muted-foreground mb-2">
            将融合 API Key 作为 Bearer Token 使用，通过 <code className="font-mono bg-muted px-1 rounded">/v1</code> 端点调用：
          </p>
          <pre className="overflow-x-auto rounded-lg bg-background p-3 text-[11px] leading-relaxed font-mono border">{`POST /v1/chat/completions
Authorization: Bearer fap-xxxxxxxx...

{
  "model": "gpt-3.5-turbo",
  "messages": [{"role": "user", "content": "Hello"}]
}`}</pre>
        </div>
      )}
    </div>
  )
}
