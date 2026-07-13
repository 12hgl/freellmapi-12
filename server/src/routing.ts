// ============================================================
// 后端 API 路由说明（汉化）
// 本文件列出所有后端路由及其功能说明，用于文档和开发参考。
// ============================================================

export const ROUTE_MAP: Record<string, string> = {
  // ─── 密钥管理 ────────────────────────────────────────────────
  'GET    /api/keys': '获取所有 API 密钥列表（含提供商密钥和自定义端点）',
  'POST   /api/keys': '添加提供商 API 密钥',
  'PATCH  /api/keys/:id': '更新密钥（启用/禁用、标签）',
  'DELETE /api/keys/:id': '删除单个 API 密钥',
  'PATCH  /api/keys/platform/:platform': '批量启用/禁用指定平台的所有密钥',
  'POST   /api/keys/import/preview': '预览导入文件中的密钥',
  'POST   /api/keys/import': '从文件批量导入密钥',
  'POST   /api/keys/custom': '添加自定义 OpenAI 兼容端点（对话模型）',
  'POST   /api/embeddings/custom': '添加自定义嵌入模型端点',
  'POST   /api/media/custom': '添加自定义媒体模型端点（图像/音频）',
  'GET    /api/keys/export': '导出 API 密钥（JSON/ENV/CSV）',

  // ─── 健康检查 ────────────────────────────────────────────────
  'GET    /api/health': '获取所有密钥健康状态汇总',
  'POST   /api/health/check': '触发全部密钥健康检查',
  'POST   /api/health/check/:keyId': '触发单个密钥健康检查',

  // ─── 模型管理 ────────────────────────────────────────────────
  'GET    /api/models': '获取所有对话模型列表',
  'GET    /api/models/custom': '获取自定义对话模型列表',
  'DELETE /api/models/custom/:id': '删除自定义对话模型',
  'PATCH  /api/models/settings': '更新模型设置（显示名称、上下文窗口等）',
  'GET    /api/models/fallback': '获取模型回退链配置',
  'PUT    /api/models/fallback': '更新模型回退链配置',

  // ─── 嵌入模型 ────────────────────────────────────────────────
  'GET    /api/embeddings': '获取嵌入模型列表',
  'DELETE /api/embeddings/custom/:id': '删除自定义嵌入模型',

  // ─── 媒体模型 ────────────────────────────────────────────────
  'GET    /api/media': '获取图像/音频模型列表',
  'DELETE /api/media/custom/:id': '删除自定义媒体模型',

  // ─── 统一 API ────────────────────────────────────────────────
  'POST   /v1/chat/completions': 'OpenAI 兼容对话补全端点',
  'POST   /v1/embeddings': 'OpenAI 兼容嵌入端点',
  'POST   /v1/images/generations': 'OpenAI 兼容图像生成端点',
  'POST   /v1/audio/speech': 'OpenAI 兼容文本转语音端点',
  'GET    /v1/models': 'OpenAI 兼容模型列表端点',
  'POST   /v1/messages': 'Anthropic 兼容消息端点',

  // ─── 融合 ────────────────────────────────────────────────────
  'GET    /api/fusion': '获取融合配置',
  'PUT    /api/fusion': '更新融合配置',

  // ─── 系统设置 ────────────────────────────────────────────────
  'GET    /api/settings/api-key': '获取统一 API 密钥',
  'POST   /api/settings/api-key/regenerate': '重新生成统一 API 密钥',
  'GET    /api/settings/proxy': '获取出站代理配置',
  'PUT    /api/settings/proxy': '更新出站代理配置',
  'GET    /api/settings/unify': '获取模型合并设置',
  'PUT    /api/settings/unify': '更新模型合并设置',
  'GET    /api/settings/fusion': '获取融合默认配置',
  'PUT    /api/settings/fusion': '更新融合默认配置',
  'GET    /api/settings/anthropic-map': '获取 Anthropic 模型映射',
  'PUT    /api/settings/anthropic-map': '更新 Anthropic 模型映射',
  'GET    /api/settings/admin-port-separation': '获取管理面板端口分离设置',
  'POST   /api/settings/admin-port-separation': '更新管理面板端口分离设置',
  'GET    /api/settings/api-key-check': '获取自动密钥检查设置',
  'POST   /api/settings/api-key-check': '更新自动密钥检查设置',
  'GET    /api/settings/ip-limit': '获取 IP 登录限流配置',
  'PUT    /api/settings/ip-limit': '更新 IP 登录限流配置',
  'GET    /api/settings/smtp-log': '获取 SMTP 日志设置',
  'PUT    /api/settings/smtp-log': '更新 SMTP 日志设置',
  'GET    /api/settings/latest-version': '获取最新版本信息（读取 LATEST.json）',

  // ─── SMTP 邮件通知 ───────────────────────────────────────────
  'GET    /api/smtp/config': '获取 SMTP 邮件通知服务配置',
  'POST   /api/smtp/config': '更新 SMTP 邮件通知服务配置',
  'POST   /api/smtp/send-code': '发送邮箱验证码',
  'POST   /api/smtp/verify-code': '验证邮箱验证码',

  // ─── 自动同步 ────────────────────────────────────────────────
  'GET    /api/premium': '获取自动同步状态与配置',
  'POST   /api/premium/toggle-sync': '切换自动同步开关',
  'POST   /api/premium/toggle-auto-update': '切换自动应用更新开关',
  'POST   /api/premium/sync': '立即执行一次同步',
  'POST   /api/premium/set-custom-url': '设置自定义同步源 URL',

  // ─── 分析 ────────────────────────────────────────────────────
  'GET    /api/analytics/requests': '获取请求量统计',
  'GET    /api/analytics/tokens': '获取令牌用量统计',
  'GET    /api/analytics/latency': '获取延迟统计',
  'GET    /api/analytics/errors': '获取错误统计',
  'GET    /api/analytics/recent': '获取最近调用记录',

  // ─── 认证 ────────────────────────────────────────────────────
  'POST   /api/auth/setup': '首次设置管理员账户',
  'POST   /api/auth/login': '管理员登录',
  'POST   /api/auth/logout': '管理员退出登录',
  'GET    /api/auth/status': '获取当前登录状态',
};
