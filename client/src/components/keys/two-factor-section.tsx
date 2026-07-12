import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Mail, Settings, Eye, EyeOff } from 'lucide-react'

interface SmtpConfig {
  configured: boolean
  host: string
  port: number
  user: string
  hasPass: boolean
  from: string
}

export function TwoFactorSection() {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [host, setHost] = useState('')
  const [port, setPort] = useState('587')
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [from, setFrom] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [saved, setSaved] = useState(false)

  const { data: smtp } = useQuery<SmtpConfig>({
    queryKey: ['smtp-config'],
    queryFn: () => apiFetch('/api/smtp/config'),
  })

  useEffect(() => {
    if (smtp && showForm) {
      setHost(smtp.host)
      setPort(String(smtp.port || 587))
      setUser(smtp.user)
      setFrom(smtp.from)
    }
  }, [smtp, showForm])

  const saveSmtp = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch('/api/smtp/config', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smtp-config'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    },
  })

  const handleSave = () => {
    saveSmtp.mutate({
      host: host.trim(),
      port: parseInt(port, 10) || 587,
      user: user.trim(),
      pass: pass,
      from: from.trim(),
    })
  }

  return (
    <div className="rounded-2xl border bg-card p-5">
      <div className="flex items-center gap-2 mb-3">
        <Mail className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">登录邮箱验证 (SMTP)</h2>
      </div>

      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <p className="text-xs text-muted-foreground">
            {smtp?.configured
              ? `已配置 SMTP → ${smtp.host}`
              : '未配置 SMTP，登录时将跳过邮箱验证'}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowForm(!showForm)}
          className="shrink-0"
        >
          <Settings className="size-3.5" />
          {showForm ? '收起' : '设置'}
        </Button>
      </div>

      {showForm && (
        <div className="space-y-3 border-t pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">SMTP 服务器</Label>
              <Input
                value={host}
                onChange={e => setHost(e.target.value)}
                placeholder="smtp.gmail.com"
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">端口</Label>
              <Input
                value={port}
                onChange={e => setPort(e.target.value)}
                placeholder="587"
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">邮箱账号</Label>
              <Input
                value={user}
                onChange={e => setUser(e.target.value)}
                placeholder="your@email.com"
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">邮箱密码 / 授权码</Label>
              <div className="relative">
                <Input
                  type={showPass ? 'text' : 'password'}
                  value={pass}
                  onChange={e => setPass(e.target.value)}
                  placeholder={smtp?.hasPass ? '•••••••• (留空不变)' : '输入邮箱授权码'}
                  className="h-9 text-sm pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPass ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">发件人显示名（可选）</Label>
              <Input
                value={from}
                onChange={e => setFrom(e.target.value)}
                placeholder="FreeLLMAPI"
                className="h-9 text-sm"
              />
            </div>
            <div className="flex items-end">
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saveSmtp.isPending}
                className="w-full h-9"
              >
                {saveSmtp.isPending ? '保存中…' : saved ? '已保存' : '保存设置'}
              </Button>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">
            保存后，登录时将向注册邮箱发送验证码进行二次验证。建议使用 SMTP 授权码而非邮箱密码。
          </p>
        </div>
      )}
    </div>
  )
}
