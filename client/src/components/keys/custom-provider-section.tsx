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

// Split a free-text model field on commas / newlines into a clean id list,
// dropping blanks and duplicates so one endpoint can take several models. (#281)
function parseModelList(raw: string): string[] {
  const seen = new Set<string>()
  return raw
    .split(/[\n,]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !seen.has(s) && seen.add(s))
}

interface ProbedModel {
  id: string
  supportsTools: boolean
  supportsVision: boolean
  intelligenceRank: number
  speedRank: number
}

// Always rendered inside the Add key dialog: no outer section chrome/heading.
// `onAdded` lets that dialog close (and surface a toast) once a custom model is
// saved.
export function CustomProviderSection({ onAdded }: { onAdded?: () => void } = {}) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [customType, setCustomType] = useState<'chat' | 'embedding' | 'image' | 'audio'>('chat')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [family, setFamily] = useState('')
  const [apiKey, setApiKey] = useState('')
  // Capabilities are auto-detected via the probe endpoint; manually settable
  // as fallback when discovery is skipped.
  const [supportsTools, setSupportsTools] = useState(true)
  const [supportsVision, setSupportsVision] = useState(false)
  // Probe results: per-model capabilities from auto-discovery.
  const [probedModels, setProbedModels] = useState<ProbedModel[] | null>(null)
  const [toolsDetected, setToolsDetected] = useState(false)

  const models = customType === 'chat' ? parseModelList(model) : [model.trim()].filter(Boolean)
  const multiple = customType === 'chat' && models.length > 1

  // Field-level validation: submit stays clickable and reveals what is
  // missing instead of being silently disabled.
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

  // Probe endpoint to discover models + capabilities from the custom endpoint.
  const probe = useMutation({
    meta: { silenceToast: true },
    mutationFn: (body: { baseUrl: string; apiKey?: string }) =>
      apiFetch<{ models: ProbedModel[]; toolsDetected: boolean }>('/api/keys/custom/probe', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => {
      const ids = data.models.map(m => m.id).join('\n')
      setModel(ids)
      setProbedModels(data.models)
      setToolsDetected(data.toolsDetected)
      setSupportsTools(data.toolsDetected)
      // Set per-model vision: apply the first model's vision guess as default;
      // individual model capabilities are carried in probedModels for submit.
      setSupportsVision(data.models.some(m => m.supportsVision))
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
      setToolsDetected(false)
      setSupportsTools(true)
      setSupportsVision(false)
      if (onAdded) {
        toast.success(t('keys.modelAdded'))
        onAdded()
      }
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

  // Build model entries for submission. When probedModels is available,
  // each model carries its own capability flags; otherwise fall back to
  // the top-level toggles.
  const buildModelEntries = (): (
    | string
    | { model: string; displayName?: string; supportsTools?: boolean; supportsVision?: boolean; intelligenceRank?: number; speedRank?: number }
  )[] => {
    if (!probedModels || models.length === 0) return models
    const probedMap = new Map(probedModels.map(p => [p.id, p]))
    return models.map(id => {
      const p = probedMap.get(id)
      return p
        ? {
            model: p.id,
            supportsTools: p.supportsTools,
            supportsVision: p.supportsVision,
            intelligenceRank: p.intelligenceRank,
            speedRank: p.speedRank,
          }
        : id
    })
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (baseUrlError || modelError) {
      setAttempted(true)
      return
    }
    setAttempted(false)
    const common = {
      baseUrl,
      model: models[0],
      displayName: !multiple ? (displayName || undefined) : undefined,
      apiKey: apiKey || undefined,
    }
    if (customType === 'chat') {
      // When probed, pass per-model capability entries.
      const entries = buildModelEntries()
      addCustom.mutate({
        path: '/api/keys/custom',
        body: {
          baseUrl,
          models: entries,
          displayName: !multiple ? (displayName || undefined) : undefined,
          apiKey: apiKey || undefined,
          // Top-level defaults apply only when probedModels is null.
          ...(probedModels ? {} : { supportsTools, supportsVision }),
        },
      })
      return
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

  const form = (
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">{t('keys.customType')}</Label>
          <Select value={customType} onValueChange={(v) => setCustomType(v as typeof customType)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="chat">{t('keys.customTypeChat')}</SelectItem>
              <SelectItem value="embedding">{t('keys.customTypeEmbedding')}</SelectItem>
              <SelectItem value="image">{t('keys.customTypeImage')}</SelectItem>
              <SelectItem value="audio">{t('keys.customTypeAudio')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 flex-1 min-w-[240px]">
          <Label className="text-xs">{t('keys.customBaseUrl')}</Label>
          <Input
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            placeholder="http://127.0.0.1:11434/v1"
            className="font-mono text-xs"
            aria-invalid={attempted && !!baseUrlError}
          />
          {attempted && <FieldError error={baseUrlError} />}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">{customType === 'chat' ? t('keys.customModels') : t('keys.customModel')}</Label>
          <Textarea
            value={model}
            onChange={e => {
              setModel(e.target.value)
              // Clear probed results when user edits models manually.
              if (probedModels) setProbedModels(null)
            }}
            placeholder={modelPlaceholder}
            rows={customType === 'chat' ? 2 : 1}
            className="w-[200px] font-mono text-xs"
            aria-invalid={attempted && !!modelError}
          />
          {attempted && <FieldError error={modelError} />}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">{t('keys.customDisplayName')}</Label>
          <Input
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder={multiple ? t('keys.customDisplayNamePerModel') : t('keys.customDisplayNameOptional')}
            disabled={multiple}
            className="w-[150px]"
          />
        </div>
        {customType === 'embedding' && (
          <div className="space-y-1.5">
            <Label className="text-xs">{t('keys.customFamily')}</Label>
            <Input
              value={family}
              onChange={e => setFamily(e.target.value)}
              placeholder={embeddingsData?.families?.[0]?.family ?? t('keys.customFamilyPlaceholder')}
              className="w-[190px] font-mono text-xs"
            />
          </div>
        )}
        {customType === 'chat' && (
          <div className="space-y-1.5">
            <Label className="text-xs">{t('keys.customCapabilities')}</Label>
            <div className="flex h-9 items-center gap-4">
              {probedModels && models.length > 0 ? (
                <span className="text-xs text-muted-foreground">
                  {toolsDetected ? t('keys.toolsDetected') : t('keys.toolsNotDetected')}
                </span>
              ) : (
                <>
                  <label className="flex items-center gap-1.5 text-xs">
                    <Switch size="sm" checked={supportsTools} onCheckedChange={setSupportsTools} />
                    <span>{t('models.tools')}</span>
                  </label>
                  <label className="flex items-center gap-1.5 text-xs">
                    <Switch size="sm" checked={supportsVision} onCheckedChange={setSupportsVision} />
                    <span>{t('models.vision')}</span>
                  </label>
                </>
              )}
            </div>
          </div>
        )}
        {customType === 'chat' && (
          <div className="space-y-1.5 self-end">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={probe.isPending || !baseUrl.trim()}
              onClick={handleDiscover}
            >
              {probe.isPending ? t('keys.discovering') : t('keys.discoverModels')}
            </Button>
          </div>
        )}
        <div className="space-y-1.5">
          <Label className="text-xs">{t('keys.customApiKey')}</Label>
          <Input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder={t('keys.customDisplayNameOptional')}
            className="w-[150px] font-mono text-xs"
          />
        </div>
        <Button type="submit" size="sm" disabled={addCustom.isPending}>
          {addCustom.isPending ? t('keys.addingCustom') : addLabel}
        </Button>
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
