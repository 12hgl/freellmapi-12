import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FieldError } from '@/components/ui/field-error'
import { isHttpUrl } from '@/lib/validate'
import { useI18n } from '@/i18n'
import { toast } from '@/lib/toast'

// ── helpers ──────────────────────────────────────────────────────────────

function parseModelList(raw: string): string[] {
  const seen = new Set<string>()
  return raw
    .split(/[\n,]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()))
}

// ── types ────────────────────────────────────────────────────────────────

type ModelType = 'chat' | 'embedding' | 'image' | 'audio'

interface ProbedModel {
  id: string
  displayName: string
  type: ModelType
  supportsTools: boolean
  supportsVision: boolean
  intelligenceRank: number
  speedRank: number
}

interface ProbeResult {
  models: ProbedModel[]
  toolsDetected: boolean
  typeSummary: { chat: number; embedding: number; image: number; audio: number }
}

type ModelEntry =
  | string
  | {
      model: string
      displayName?: string
      supportsTools?: boolean
      supportsVision?: boolean
      intelligenceRank?: number
      speedRank?: number
    }

// ── component ────────────────────────────────────────────────────────────

export function CustomProviderSection({ onAdded }: { onAdded?: () => void } = {}) {
  const { t } = useI18n()
  const queryClient = useQueryClient()

  const [customType, setCustomType] = useState<ModelType>('chat')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [family, setFamily] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [supportsTools, setSupportsTools] = useState(true)
  const [supportsVision, setSupportsVision] = useState(false)

  const [probedModels, setProbedModels] = useState<ProbedModel[] | null>(null)
  const [typeSummary, setTypeSummary] = useState<ProbeResult['typeSummary'] | null>(null)

  const models = customType === 'chat' ? parseModelList(model) : [model.trim()].filter(Boolean)
  const multiple = customType === 'chat' && models.length > 1

  const [attempted, setAttempted] = useState(false)
  const baseUrlError = !baseUrl.trim()
    ? t('validation.required')
    : !isHttpUrl(baseUrl)
      ? t('validation.url')
      : null
  const modelError = models.length === 0 ? t('validation.required') : null

  const { data: embeddingsData } = useQuery<{ families: { family: string }[] }>({
    queryKey: ['embeddings'],
    queryFn: () => apiFetch('/api/embeddings'),
  })

  const probe = useMutation({
    meta: { silenceToast: true },
    mutationFn: (body: { baseUrl: string; apiKey?: string }) =>
      apiFetch<ProbeResult>('/api/keys/custom/probe', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => {
      setProbedModels(data.models)
      setTypeSummary(data.typeSummary)
      setSupportsTools(data.toolsDetected)
      setSupportsVision(data.models.some(m => m.supportsVision))

      const { chat, embedding, image, audio } = data.typeSummary
      if (embedding > chat && embedding > image && embedding > audio) setCustomType('embedding')
      else if (image > chat && image > embedding && image > audio) setCustomType('image')
      else if (audio > chat && audio > embedding && audio > image) setCustomType('audio')
      else setCustomType('chat')

      setModel(data.models.map(m => m.id).join('\n'))
      toast.success(t('keys.modelsDiscovered', { count: data.models.length }))
    },
    onError: (err: Error) => {
      toast.error(err.message || t('keys.discoverFailed'))
    },
  })

  const addCustom = useMutation({
    meta: { silenceToast: true },
    mutationFn: ({ path, body }: { path: string; body: Record<string, unknown> }) =>
      apiFetch(path, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['keys'] })
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['fallback'] })
      queryClient.invalidateQueries({ queryKey: ['models'] })
      queryClient.invalidateQueries({ queryKey: ['embeddings'] })
      queryClient.invalidateQueries({ queryKey: ['media'] })
      setModel('')
      setDisplayName('')
      setFamily('')
      setProbedModels(null)
      setTypeSummary(null)
      setSupportsTools(true)
      setSupportsVision(false)
      if (onAdded) toast.success(t('keys.modelAdded')) && onAdded()
    },
  })

  const handleDiscover = () => {
    if (!baseUrl.trim() || !isHttpUrl(baseUrl)) {
      setAttempted(true)
      return
    }
    setAttempted(false)
    probe.mutate({ baseUrl: baseUrl.trim(), apiKey: apiKey || undefined })
  }

  const buildModelEntries = (): ModelEntry[] => {
    if (!probedModels || models.length === 0) return models
    const probedMap = new Map(probedModels.map(p => [p.id, p]))
    const lowerMap = new Map<string, ProbedModel>()
    for (const p of probedModels) lowerMap.set(p.id.toLowerCase(), p)

    return models.map(id => {
      const p = probedMap.get(id) ?? lowerMap.get(id.toLowerCase())
      if (p) {
        return {
          model: p.id,
          supportsTools: p.supportsTools,
          supportsVision: p.supportsVision,
          intelligenceRank: p.intelligenceRank,
          speedRank: p.speedRank,
        }
      }
      return id
    })
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (baseUrlError || modelError) {
      setAttempted(true)
      return
    }
    setAttempted(false)

    if (customType === 'chat') {
      const entries = buildModelEntries()
      addCustom.mutate({
        path: '/api/keys/custom',
        body: {
          baseUrl,
          models: entries,
          displayName: !multiple ? (displayName || undefined) : undefined,
          apiKey: apiKey || undefined,
          ...(probedModels ? {} : { supportsTools, supportsVision }),
        },
      })
      return
    }
    const common = {
      baseUrl,
      model: models[0],
      displayName: displayName || undefined,
      apiKey: apiKey || undefined,
    }
    if (customType === 'embedding') {
      addCustom.mutate({
        path: '/api/embeddings/custom',
        body: { ...common, family: family || undefined },
      })
      return
    }
    addCustom.mutate({
      path: '/api/media/custom',
      body: { ...common, modality: customType },
    })
  }

  const modelPlaceholder = customType === 'chat'
    ? 'qwen3:4b\nllama3:8b'
    : customType === 'embedding'
      ? 'text-embedding-3-small'
      : customType === 'image'
        ? 'gpt-image-1'
        : 'gpt-4o-mini-tts'

  const addLabel = customType === 'chat'
    ? (multiple ? t('keys.addModels', { count: models.length }) : t('keys.addModel'))
    : customType === 'embedding'
      ? t('keys.addEmbeddingModel')
      : customType === 'image'
        ? t('keys.addImageModel')
        : t('keys.addAudioModel')

  const typeLabels: Record<ModelType, string> = {
    chat: t('keys.customTypeChat'),
    embedding: t('keys.customTypeEmbedding'),
    image: t('keys.customTypeImage'),
    audio: t('keys.customTypeAudio'),
  }

  const probedSummary = probedModels && typeSummary ? (
    <div className="w-full space-y-1.5 mt-1">
      <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
        {typeSummary.chat > 0 && <span className="px-1.5 py-0.5 rounded bg-accent">{typeLabels.chat}: {typeSummary.chat}</span>}
        {typeSummary.embedding > 0 && <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">{typeLabels.embedding}: {typeSummary.embedding}</span>}
        {typeSummary.image > 0 && <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300">{typeLabels.image}: {typeSummary.image}</span>}
        {typeSummary.audio > 0 && <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300">{typeLabels.audio}: {typeSummary.audio}</span>}
      </div>
    </div>
  ) : null

  const textareaRows = probedModels
    ? Math.min(12, Math.max(2, probedModels.length + 1))
    : (customType === 'chat' ? 2 : 1)

  const form = (
    <form onSubmit={submit} className="flex flex-wrap items-start gap-3">
      {/* Type */}
      <div className="space-y-1.5">
        <Label className="text-xs">{t('keys.customType')}</Label>
        <Select value={customType} onValueChange={(v) => setCustomType(v as ModelType)}>
          <SelectTrigger className="w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="chat">{typeLabels.chat}</SelectItem>
            <SelectItem value="embedding">{typeLabels.embedding}</SelectItem>
            <SelectItem value="image">{typeLabels.image}</SelectItem>
            <SelectItem value="audio">{typeLabels.audio}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Base URL */}
      <div className="space-y-1.5 min-w-[220px] flex-1">
        <Label className="text-xs">{t('keys.customBaseUrl')}</Label>
        <Input
          value={baseUrl}
          onChange={e => setBaseUrl(e.target.value)}
          placeholder="http://127.0.0.1:11434/v1"
          className="font-mono text-xs"
          aria-invalid={attempted && !!baseUrlError}
          spellCheck={false}
        />
        {attempted && <FieldError error={baseUrlError} />}
      </div>

      {/* Models */}
      <div className="space-y-1.5 min-w-[240px] flex-[2]">
        <div className="flex items-center justify-between">
          <Label className="text-xs">{customType === 'chat' ? t('keys.customModels') : t('keys.customModel')}</Label>
          {customType === 'chat' && (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="h-5 px-1.5 text-[10px]"
              disabled={probe.isPending || !baseUrl.trim()}
              onClick={handleDiscover}
            >
              {probe.isPending ? t('keys.discovering') : t('keys.discoverModels')}
            </Button>
          )}
        </div>
        <Textarea
          value={model}
          onChange={e => {
            setModel(e.target.value)
            if (probedModels) setProbedModels(null)
          }}
          placeholder={modelPlaceholder}
          rows={textareaRows}
          className="w-full font-mono text-xs min-h-[48px]"
          aria-invalid={attempted && !!modelError}
          spellCheck={false}
        />
        {attempted && <FieldError error={modelError} />}
      </div>

      {/* Display name */}
      <div className="space-y-1.5">
        <Label className="text-xs">{t('keys.customDisplayName')}</Label>
        <Input
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          placeholder={multiple ? t('keys.customDisplayNamePerModel') : t('keys.customDisplayNameOptional')}
          disabled={multiple}
          className="w-[140px]"
          spellCheck={false}
        />
      </div>

      {/* Family (embedding only) */}
      {customType === 'embedding' && (
        <div className="space-y-1.5">
          <Label className="text-xs">{t('keys.customFamily')}</Label>
          <Input
            value={family}
            onChange={e => setFamily(e.target.value)}
            placeholder={embeddingsData?.families?.[0]?.family ?? t('keys.customFamilyPlaceholder')}
            className="w-[160px] font-mono text-xs"
            spellCheck={false}
          />
        </div>
      )}

      {/* Capabilities (chat only, manual mode) */}
      {customType === 'chat' && !probedModels && (
        <div className="space-y-1.5">
          <Label className="text-xs">{t('keys.customCapabilities')}</Label>
          <div className="flex h-9 items-center gap-4">
            <label className="flex items-center gap-1.5 text-xs">
              <Switch size="sm" checked={supportsTools} onCheckedChange={setSupportsTools} />
              <span>{t('models.tools')}</span>
            </label>
            <label className="flex items-center gap-1.5 text-xs">
              <Switch size="sm" checked={supportsVision} onCheckedChange={setSupportsVision} />
              <span>{t('models.vision')}</span>
            </label>
          </div>
        </div>
      )}

      {/* API Key */}
      <div className="space-y-1.5">
        <Label className="text-xs">{t('keys.customApiKey')}</Label>
        <Input
          type="password"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder={t('keys.customDisplayNameOptional')}
          className="w-[140px] font-mono text-xs"
          spellCheck={false}
        />
      </div>

      {/* Submit */}
      <div className="space-y-1.5 self-end">
        <Button type="submit" size="sm" disabled={addCustom.isPending}>
          {addCustom.isPending ? t('keys.addingCustom') : addLabel}
        </Button>
      </div>

      {probedSummary}
    </form>
  )

  const errorLine = addCustom.isError ? (
    <p className="text-destructive text-xs mt-2">{(addCustom.error as Error).message}</p>
  ) : null

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-3">{t('keys.addCustomDescription')}</p>
      {form}
      {errorLine}
    </div>
  )
}
