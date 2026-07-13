/**
 * Built-in model capability knowledge base for custom provider auto-discovery.
 *
 * When a user points a custom endpoint at an OpenAI-compatible server, the
 * probe endpoint fetches /v1/models and then matches each model ID against
 * this database to determine:
 *   - supportsTools   — function-calling / tool-use support
 *   - supportsVision  — multimodal image-input support
 *   - intelligenceRank — heuristic 0-100 score
 *   - speedRank        — heuristic 0-100 score (higher = faster)
 *
 * Rankings are heuristics based on public benchmarks (MMLU / Arena ELO /
 * HumanEval) and parameter count, normalised to the 0-100 range used by
 * the FreeLLMAPI catalog. They are NOT precise scientific measurements — the
 * goal is to give a reasonable starting point that the user can fine-tune
 * later in the model settings panel.
 */

export type ModelType = 'chat' | 'embedding' | 'image' | 'audio';

export interface ModelCapability {
  supportsTools: boolean;
  supportsVision: boolean;
  intelligenceRank: number;
  speedRank: number;
  type: ModelType;
}

/**
 * Per-family defaults applied when a model id contains a known family token.
 * Families are checked in order; the first match wins.
 */
interface FamilyRule {
  /** Case-insensitive substring to match in the model id. */
  token: string;
  capabilities: ModelCapability;
}

/**
 * Exact model id overrides that take precedence over family rules.
 */
interface ModelOverride {
  /** Exact case-insensitive model id match. */
  id: string;
  capabilities: ModelCapability;
}

// ── Intelligence / Speed heuristics ──────────────────────────────────────
// Rough tiers derived from public benchmarks + parameter count.
// Higher intelligence → higher MMLU / Arena ELO / reasoning.
// Higher speed → fewer params / flash variants / CPU-friendly.

const CHAT = 'chat' as ModelType;
const EMBED = 'embedding' as ModelType;
const IMAGE = 'image' as ModelType;
const AUDIO = 'audio' as ModelType;

const TIER_S: ModelCapability = { type: CHAT, supportsTools: true, supportsVision: false, intelligenceRank: 90, speedRank: 10 };
const TIER_A: ModelCapability = { type: CHAT, supportsTools: true, supportsVision: false, intelligenceRank: 82, speedRank: 20 };
const TIER_B: ModelCapability = { type: CHAT, supportsTools: true, supportsVision: false, intelligenceRank: 72, speedRank: 40 };
const TIER_C: ModelCapability = { type: CHAT, supportsTools: true, supportsVision: false, intelligenceRank: 62, speedRank: 60 };
const TIER_D: ModelCapability = { type: CHAT, supportsTools: true, supportsVision: false, intelligenceRank: 52, speedRank: 75 };
const TIER_E: ModelCapability = { type: CHAT, supportsTools: false, supportsVision: false, intelligenceRank: 42, speedRank: 88 };

// Vision tiers — all have supportsVision: true, tools vary.
const TIER_VISION_A: ModelCapability = { type: CHAT, supportsTools: true, supportsVision: true, intelligenceRank: 82, speedRank: 18 };
const TIER_VISION_B: ModelCapability = { type: CHAT, supportsTools: true, supportsVision: true, intelligenceRank: 70, speedRank: 35 };
const TIER_VISION_C: ModelCapability = { type: CHAT, supportsTools: false, supportsVision: true, intelligenceRank: 55, speedRank: 55 };

// Embedding tiers
const TIER_EMBED_A: ModelCapability = { type: EMBED, supportsTools: false, supportsVision: false, intelligenceRank: 40, speedRank: 70 };
const TIER_EMBED_B: ModelCapability = { type: EMBED, supportsTools: false, supportsVision: false, intelligenceRank: 30, speedRank: 85 };

// Image generation tiers
const TIER_IMAGE_A: ModelCapability = { type: IMAGE, supportsTools: false, supportsVision: false, intelligenceRank: 60, speedRank: 30 };
const TIER_IMAGE_B: ModelCapability = { type: IMAGE, supportsTools: false, supportsVision: false, intelligenceRank: 45, speedRank: 50 };

// Audio tiers
const TIER_AUDIO_A: ModelCapability = { type: AUDIO, supportsTools: false, supportsVision: false, intelligenceRank: 50, speedRank: 50 };

// ── Exact model overrides (checked first) ────────────────────────────────
const MODEL_OVERRIDES: ModelOverride[] = [
  // ── Qwen 3 family ──
  { id: 'qwen3:235b',           capabilities: TIER_S },
  { id: 'qwen3-235b',           capabilities: { ...TIER_S, intelligenceRank: 88 } },
  { id: 'qwen3:72b',            capabilities: TIER_A },
  { id: 'qwen3-72b',            capabilities: TIER_A },
  { id: 'qwen3:32b',            capabilities: { ...TIER_B, intelligenceRank: 76 } },
  { id: 'qwen3-32b',            capabilities: { ...TIER_B, intelligenceRank: 76 } },
  { id: 'qwen3:14b',            capabilities: TIER_C },
  { id: 'qwen3-14b',            capabilities: TIER_C },
  { id: 'qwen3:8b',             capabilities: TIER_D },
  { id: 'qwen3-8b',             capabilities: TIER_D },
  { id: 'qwen3:4b',             capabilities: TIER_E },
  { id: 'qwen3-4b',             capabilities: { ...TIER_E, intelligenceRank: 38 } },
  { id: 'qwen3:1.5b',           capabilities: { ...TIER_E, intelligenceRank: 30, speedRank: 95 } },
  { id: 'qwen3:0.5b',           capabilities: { ...TIER_E, intelligenceRank: 22, speedRank: 98 } },
  // qwen3-coder
  { id: 'qwen3-coder:480b',     capabilities: { ...TIER_S, intelligenceRank: 92 } },
  { id: 'qwen3-coder-480b',     capabilities: { ...TIER_S, intelligenceRank: 92 } },
  { id: 'qwen3-coder:30b',      capabilities: { ...TIER_B, intelligenceRank: 78 } },
  { id: 'qwen3-coder:14b',      capabilities: TIER_C },
  { id: 'qwen3-coder:8b',       capabilities: TIER_D },

  // ── Qwen 2.5 VL (vision) ──
  { id: 'qwen2.5-vl:72b',       capabilities: { ...TIER_VISION_A, intelligenceRank: 80 } },
  { id: 'qwen2.5-vl:32b',       capabilities: { ...TIER_VISION_B, intelligenceRank: 74 } },
  { id: 'qwen2.5-vl:7b',        capabilities: { ...TIER_VISION_C, intelligenceRank: 58 } },
  { id: 'qwen2.5-vl:3b',        capabilities: { ...TIER_VISION_C, intelligenceRank: 45, speedRank: 70 } },
  // Qwen 2 VL
  { id: 'qwen2-vl:72b',         capabilities: { ...TIER_VISION_A, intelligenceRank: 78 } },
  { id: 'qwen2-vl:7b',          capabilities: { ...TIER_VISION_C, intelligenceRank: 55 } },
  { id: 'qwen2-vl:2b',          capabilities: { ...TIER_VISION_C, intelligenceRank: 40, speedRank: 75 } },

  // ── Llama 4 ──
  { id: 'llama4:maverick',      capabilities: { ...TIER_A, intelligenceRank: 84 } },
  { id: 'llama4:scout',         capabilities: TIER_B },
  { id: 'llama-4-maverick',     capabilities: { ...TIER_A, intelligenceRank: 84 } },
  { id: 'llama-4-scout',        capabilities: TIER_B },

  // ── Llama 3.3 / 3.2 / 3.1 ──
  { id: 'llama3.3:70b',         capabilities: TIER_A },
  { id: 'llama3.3-70b',         capabilities: TIER_A },
  { id: 'llama3.2:3b',          capabilities: { ...TIER_E, intelligenceRank: 38 } },
  { id: 'llama3.2:1b',          capabilities: { ...TIER_E, intelligenceRank: 25, speedRank: 96 } },
  { id: 'llama3.1:405b',        capabilities: TIER_S },
  { id: 'llama3.1:70b',         capabilities: TIER_A },
  { id: 'llama3.1:8b',          capabilities: TIER_D },
  { id: 'llama3:70b',           capabilities: TIER_A },
  { id: 'llama3:8b',            capabilities: TIER_D },
  // Llama 3.2 Vision
  { id: 'llama3.2-vision:90b',  capabilities: { ...TIER_VISION_A, intelligenceRank: 80 } },
  { id: 'llama3.2-vision:11b',  capabilities: { ...TIER_VISION_B, intelligenceRank: 65 } },

  // ── DeepSeek ──
  { id: 'deepseek-r1:671b',     capabilities: { ...TIER_S, intelligenceRank: 95 } },
  { id: 'deepseek-r1:70b',      capabilities: { ...TIER_A, intelligenceRank: 85 } },
  { id: 'deepseek-r1:32b',      capabilities: { ...TIER_B, intelligenceRank: 78 } },
  { id: 'deepseek-r1:14b',      capabilities: { ...TIER_C, intelligenceRank: 70 } },
  { id: 'deepseek-r1:8b',       capabilities: { ...TIER_D, intelligenceRank: 62 } },
  { id: 'deepseek-r1:7b',       capabilities: { ...TIER_D, intelligenceRank: 60 } },
  { id: 'deepseek-r1:1.5b',     capabilities: { ...TIER_E, intelligenceRank: 35 } },
  { id: 'deepseek-v3:671b',     capabilities: { ...TIER_S, intelligenceRank: 93 } },
  { id: 'deepseek-coder:33b',   capabilities: { ...TIER_B, intelligenceRank: 76 } },
  { id: 'deepseek-coder:6.7b',  capabilities: TIER_D },
  { id: 'deepseek-coder-v2',    capabilities: { ...TIER_A, intelligenceRank: 86 } },
  { id: 'deepseek-v2',          capabilities: { ...TIER_A, intelligenceRank: 84 } },

  // ── Mistral ──
  { id: 'mistral-large',        capabilities: TIER_A },
  { id: 'mistral-medium',       capabilities: TIER_B },
  { id: 'mistral-small',        capabilities: TIER_C },
  { id: 'mistral:7b',           capabilities: TIER_D },
  { id: 'mistral-nemo',         capabilities: TIER_C },
  { id: 'mixtral:8x7b',         capabilities: { ...TIER_B, intelligenceRank: 74 } },
  { id: 'mixtral:8x22b',        capabilities: { ...TIER_A, intelligenceRank: 80 } },

  // ── Gemma 3 ──
  { id: 'gemma3:27b',           capabilities: { ...TIER_VISION_A, intelligenceRank: 78 } },
  { id: 'gemma3:12b',           capabilities: { ...TIER_VISION_B, intelligenceRank: 68 } },
  { id: 'gemma3:4b',            capabilities: { ...TIER_VISION_C, intelligenceRank: 50, speedRank: 65 } },
  { id: 'gemma3:1b',            capabilities: { ...TIER_VISION_C, intelligenceRank: 32, speedRank: 90 } },
  { id: 'gemma2:27b',           capabilities: TIER_A },
  { id: 'gemma2:9b',            capabilities: TIER_C },
  { id: 'gemma2:2b',            capabilities: { ...TIER_E, intelligenceRank: 35, speedRank: 90 } },

  // ── Phi-4 / Phi-3 ──
  { id: 'phi4:14b',             capabilities: TIER_C },
  { id: 'phi4-mini',            capabilities: TIER_E },
  { id: 'phi4-multimodal',      capabilities: { ...TIER_VISION_B, intelligenceRank: 66 } },
  { id: 'phi3:14b',             capabilities: TIER_C },
  { id: 'phi3:medium',          capabilities: TIER_C },
  { id: 'phi3:mini',            capabilities: { ...TIER_E, intelligenceRank: 45 } },
  { id: 'phi3.5:3.8b',          capabilities: { ...TIER_E, intelligenceRank: 48 } },

  // ── Command R / A ──
  { id: 'command-r-plus',       capabilities: TIER_A },
  { id: 'command-r',            capabilities: TIER_B },
  { id: 'command-a',            capabilities: TIER_S },

  // ── Granite ──
  { id: 'granite3.2:8b',        capabilities: TIER_D },
  { id: 'granite3.2:2b',        capabilities: { ...TIER_E, intelligenceRank: 35 } },

  // ── Yi ──
  { id: 'yi:34b',               capabilities: TIER_B },
  { id: 'yi:9b',                capabilities: TIER_C },
  { id: 'yi:6b',                capabilities: TIER_D },

  // ── Nemotron ──
  { id: 'nemotron:70b',         capabilities: TIER_A },
  { id: 'nemotron-mini',        capabilities: TIER_C },
  { id: 'nemotron:12b',         capabilities: TIER_C },

  // ── Pixtral (vision) ──
  { id: 'pixtral:12b',          capabilities: { ...TIER_VISION_B, intelligenceRank: 68 } },
  { id: 'pixtral-large',        capabilities: { ...TIER_VISION_A, intelligenceRank: 80 } },

  // ── LLaVA (vision, older — likely no native tools) ──
  { id: 'llava:34b',            capabilities: { ...TIER_VISION_C, intelligenceRank: 60, speedRank: 40 } },
  { id: 'llava:13b',            capabilities: { ...TIER_VISION_C, intelligenceRank: 50, speedRank: 50 } },
  { id: 'llava:7b',             capabilities: { ...TIER_VISION_C, intelligenceRank: 42, speedRank: 65 } },
  { id: 'bakllava',             capabilities: { ...TIER_VISION_C, intelligenceRank: 38, speedRank: 60 } },

  // ── MiniCPM-V (vision) ──
  { id: 'minicpm-v',            capabilities: { ...TIER_VISION_B, intelligenceRank: 64 } },
  { id: 'minicpm-v:8b',         capabilities: { ...TIER_VISION_B, intelligenceRank: 64 } },

  // ── OpenAI-compatible gateways ──
  { id: 'gpt-4o',               capabilities: { ...TIER_VISION_A, intelligenceRank: 90 } },
  { id: 'gpt-4.1',              capabilities: { ...TIER_VISION_A, intelligenceRank: 88 } },
  { id: 'gpt-4-turbo',          capabilities: { ...TIER_VISION_A, intelligenceRank: 86 } },
  { id: 'gpt-4',                capabilities: { ...TIER_A, intelligenceRank: 88 } },
  { id: 'gpt-oss-120b',         capabilities: { ...TIER_A, intelligenceRank: 80 } },
  { id: 'claude-3.7-sonnet',    capabilities: { ...TIER_VISION_A, intelligenceRank: 91 } },
  { id: 'claude-3.5-sonnet',    capabilities: { ...TIER_VISION_A, intelligenceRank: 88 } },
  { id: 'claude-3-opus',        capabilities: { ...TIER_VISION_A, intelligenceRank: 86 } },
  { id: 'claude-3-haiku',       capabilities: { ...TIER_VISION_B, intelligenceRank: 74 } },
  { id: 'gemini-2.5-pro',       capabilities: { ...TIER_VISION_A, intelligenceRank: 92 } },
  { id: 'gemini-2.5-flash',     capabilities: { ...TIER_VISION_B, intelligenceRank: 78, speedRank: 40 } },
  { id: 'gemini-2.0-flash',     capabilities: { ...TIER_VISION_B, intelligenceRank: 74, speedRank: 45 } },
];

// ── Family-level pattern matching (checked after exact overrides) ────────
const FAMILY_RULES: FamilyRule[] = [
  // ── Qwen families ──
  { token: 'qwen3-coder',       capabilities: TIER_B },
  { token: 'qwen3:',            capabilities: TIER_D },
  { token: 'qwen3-',            capabilities: TIER_D },
  { token: 'qwen2.5-vl',        capabilities: TIER_VISION_B },
  { token: 'qwen2-vl',          capabilities: TIER_VISION_B },
  { token: 'qwen-vl',           capabilities: TIER_VISION_C },
  { token: 'qwq',               capabilities: TIER_B },   // Qwen reasoning
  { token: 'qwen2.5-coder',     capabilities: TIER_C },
  { token: 'qwen2.5:',          capabilities: TIER_C },
  { token: 'qwen2.5-',          capabilities: TIER_C },
  { token: 'qwen2:',            capabilities: TIER_D },
  { token: 'qwen2-',            capabilities: TIER_D },
  { token: 'qwen:',             capabilities: TIER_D },
  { token: 'qwen-',             capabilities: TIER_D },

  // ── Llama families ──
  { token: 'llama-4-maverick',  capabilities: TIER_A },
  { token: 'llama-4-scout',     capabilities: TIER_B },
  { token: 'llama4:maverick',   capabilities: TIER_A },
  { token: 'llama4:scout',      capabilities: TIER_B },
  { token: 'llama3.2-vision',   capabilities: TIER_VISION_B },
  { token: 'llama3.1:',         capabilities: TIER_C },
  { token: 'llama3.1-',         capabilities: TIER_C },
  { token: 'llama3.3:',         capabilities: TIER_B },
  { token: 'llama3.3-',         capabilities: TIER_B },
  { token: 'llama3:',           capabilities: TIER_D },
  { token: 'llama3-',           capabilities: TIER_D },
  { token: 'llama-3',           capabilities: TIER_D },
  { token: 'llama-4',           capabilities: TIER_B },

  // ── DeepSeek families ──
  { token: 'deepseek-r1:',      capabilities: TIER_C },
  { token: 'deepseek-r1-',      capabilities: TIER_C },
  { token: 'deepseek-v3',       capabilities: TIER_S },
  { token: 'deepseek-coder-v2', capabilities: TIER_A },
  { token: 'deepseek-coder:',   capabilities: TIER_D },
  { token: 'deepseek-coder-',   capabilities: TIER_D },
  { token: 'deepseek-v2:',      capabilities: TIER_A },
  { token: 'deepseek-v2-',      capabilities: TIER_A },
  { token: 'deepseek-llm',      capabilities: TIER_C },
  { token: 'deepseek:',         capabilities: TIER_D },
  { token: 'deepseek-',         capabilities: TIER_D },

  // ── Mistral / Mixtral ──
  { token: 'mistral-large',     capabilities: TIER_A },
  { token: 'mistral-medium',    capabilities: TIER_B },
  { token: 'mistral-small',     capabilities: TIER_C },
  { token: 'mistral-nemo',      capabilities: TIER_C },
  { token: 'mistral:',          capabilities: TIER_D },
  { token: 'mistral-',          capabilities: TIER_D },
  { token: 'mixtral:8x22b',     capabilities: TIER_A },
  { token: 'mixtral:8x7b',      capabilities: TIER_B },
  { token: 'mixtral:',          capabilities: TIER_B },
  { token: 'mixtral-',          capabilities: TIER_B },
  { token: 'codestral',         capabilities: TIER_C },

  // ── Gemma ──
  { token: 'gemma3:',           capabilities: TIER_VISION_B },
  { token: 'gemma3-',           capabilities: TIER_VISION_B },
  { token: 'gemma2:',           capabilities: TIER_C },
  { token: 'gemma2-',           capabilities: TIER_C },
  { token: 'gemma:',            capabilities: TIER_D },

  // ── Phi ──
  { token: 'phi4-multimodal',   capabilities: TIER_VISION_B },
  { token: 'phi-4-multimodal',  capabilities: TIER_VISION_B },
  { token: 'phi4:',             capabilities: TIER_D },
  { token: 'phi4-',             capabilities: TIER_D },
  { token: 'phi-4:',            capabilities: TIER_D },
  { token: 'phi-3.5-vision',    capabilities: TIER_VISION_C },
  { token: 'phi-3-vision',      capabilities: TIER_VISION_C },
  { token: 'phi3.5:',           capabilities: TIER_E },
  { token: 'phi3.5-',           capabilities: TIER_E },
  { token: 'phi3:',             capabilities: TIER_E },
  { token: 'phi3-',             capabilities: TIER_E },
  { token: 'phi-3:',            capabilities: TIER_E },

  // ── Vision models ──
  { token: 'pixtral',           capabilities: TIER_VISION_B },
  { token: 'llava:',            capabilities: TIER_VISION_C },
  { token: 'llava-',            capabilities: TIER_VISION_C },
  { token: 'bakllava',          capabilities: TIER_VISION_C },
  { token: 'minicpm-v',         capabilities: TIER_VISION_B },
  { token: 'cogvlm',            capabilities: TIER_VISION_C },
  { token: 'internvl',          capabilities: TIER_VISION_B },
  { token: 'glm-4v',            capabilities: TIER_VISION_A },
  { token: 'molmo',             capabilities: TIER_VISION_C },
  { token: 'paligemma',         capabilities: TIER_VISION_C },
  { token: 'fuyu',              capabilities: TIER_VISION_C },
  { token: 'idefics',           capabilities: TIER_VISION_C },
  { token: 'florence',          capabilities: TIER_VISION_C },
  { token: 'smolvlm',           capabilities: TIER_VISION_C },

  // ── Other notable models ──
  { token: 'yi:',               capabilities: TIER_D },
  { token: 'yi-',               capabilities: TIER_D },
  { token: 'command-r-plus',    capabilities: TIER_A },
  { token: 'command-r',         capabilities: TIER_B },
  { token: 'command-a',         capabilities: TIER_S },
  { token: 'nemotron:',         capabilities: TIER_C },
  { token: 'nemotron-',         capabilities: TIER_C },
  { token: 'granite',           capabilities: TIER_D },
  { token: 'dbrx',              capabilities: TIER_B },
  { token: 'falcon',            capabilities: TIER_C },
  { token: 'mpt',               capabilities: TIER_E },
  { token: 'stablelm',          capabilities: TIER_E },
  { token: 'openchat',          capabilities: TIER_E },
  { token: 'zephyr',            capabilities: TIER_E },
  { token: 'nous-hermes',       capabilities: TIER_E },
  { token: 'wizardlm',          capabilities: TIER_E },
  { token: 'vicuna',            capabilities: TIER_E },
  { token: 'orca',              capabilities: TIER_E },
  { token: 'tinyllama',         capabilities: { ...TIER_E, intelligenceRank: 25, speedRank: 98 } },
  { token: 'tinydolphin',       capabilities: { ...TIER_E, intelligenceRank: 20, speedRank: 99 } },
  { token: 'sqlcoder',          capabilities: TIER_D },
  { token: 'codegemma',         capabilities: TIER_D },
  { token: 'starcoder2',        capabilities: TIER_D },
  { token: 'starcoder',         capabilities: TIER_E },
  { token: 'codellama:',        capabilities: TIER_D },
  { token: 'codellama-',        capabilities: TIER_D },
  { token: 'magicoder',         capabilities: TIER_E },

  // ── GPT / Claude / Gemini (gateways) ──
  { token: 'gpt-4o',            capabilities: TIER_VISION_A },
  { token: 'gpt-4.1',           capabilities: TIER_VISION_A },
  { token: 'gpt-4-turbo',       capabilities: TIER_VISION_A },
  { token: 'gpt-4',             capabilities: TIER_A },
  { token: 'gpt-3.5',           capabilities: TIER_D },
  { token: 'gpt-oss',           capabilities: TIER_A },
  { token: 'claude-3.7',        capabilities: TIER_VISION_A },
  { token: 'claude-3.5',        capabilities: TIER_VISION_A },
  { token: 'claude-3',          capabilities: TIER_VISION_A },
  { token: 'gemini-2.5-pro',    capabilities: TIER_VISION_A },
  { token: 'gemini-2.5-flash',  capabilities: TIER_VISION_B },
  { token: 'gemini-2.0-flash',  capabilities: TIER_VISION_B },
  { token: 'gemini-2.0',        capabilities: TIER_VISION_B },
  { token: 'gemini-1.5-pro',    capabilities: TIER_VISION_A },
  { token: 'gemini-1.5-flash',  capabilities: TIER_VISION_B },

  // ── GLM / ChatGLM ──
  { token: 'glm-4',             capabilities: TIER_A },
  { token: 'glm4',              capabilities: TIER_A },
  { token: 'glm-3',             capabilities: TIER_B },
  { token: 'glm3',              capabilities: TIER_B },
  { token: 'chatglm3',          capabilities: TIER_B },
  { token: 'chatglm2',          capabilities: TIER_C },
  { token: 'chatglm',           capabilities: TIER_C },

  // ── Kimi / Moonshot ──
  { token: 'kimi-k2',           capabilities: TIER_A },
  { token: 'kimi',              capabilities: TIER_B },
];

// ── Default fallback for unknown models ──
const DEFAULT_CAPABILITY: ModelCapability = {
  type: CHAT,
  supportsTools: true,
  supportsVision: false,
  intelligenceRank: 50,
  speedRank: 50,
};

/**
 * Infer model type from the model ID based on naming conventions.
 */
export function inferModelType(modelId: string): ModelType {
  const lower = modelId.toLowerCase().trim();
  if (!lower) return 'chat';

  // Embedding-specific tokens
  const embedTokens = ['embed', 'bge-', 'bge_', 'gte-', 'e5-', 'stella', 'jina-embed', 'mxbai', 'nomic-embed', 'all-minilm', 'all-mpnet', 'multilingual-e5'];
  if (embedTokens.some(t => lower.includes(t))) return 'embedding';

  // Image-specific tokens
  const imageTokens = ['dall-e', 'dalle', 'stable-diffusion', 'flux', 'midjourney', 'sdxl', 'image-gen', '.image', '-image'];
  if (imageTokens.some(t => lower.includes(t))) return 'image';

  // Audio-specific tokens
  const audioTokens = ['whisper', 'tts-', 'tts_', 'speech', 'audio', 'bark-', 'parler'];
  if (audioTokens.some(t => lower.includes(t))) return 'audio';

  return 'chat';
}

/**
 * Strip commonly used vendor/model-provider prefixes from display names.
 * E.g. "deepseek-ai/DeepSeek-V3.2" → "DeepSeek-V3.2"
 */
export function stripVendorPrefix(modelId: string): string {
  const idx = modelId.indexOf('/');
  if (idx >= 0 && idx < modelId.length - 1) {
    const prefix = modelId.substring(0, idx).toLowerCase();
    // Known provider namespaces commonly used on HuggingFace / OpenRouter
    const knownPrefixes = new Set([
      'deepseek-ai', 'meta-llama', 'qwen', 'mistralai', 'microsoft',
      'google', 'anthropic', 'openai', 'cohere', 'nvidia', 'tiiuae',
      'upstage', '01-ai', 'baichuan', 'internlm', 'thudm', 'xverse',
      'openbmb', 'opencsg', 'lingodot', 'nousresearch', 'cognitivecomputations',
      'teknium', 'garage-baind', 'mlabonne', 'thebloke', 'bartowski',
      'mradermacher', 'unsloth', 'lmstudio-community', 'second-state',
      'xinference', 'vllm', 'sglang', 'ollama',
      'i1c', 'musepublic', 'pro', 'huggingface',
    ]);
    if (knownPrefixes.has(prefix)) {
      return modelId.substring(idx + 1);
    }
  }
  return modelId;
}

/**
 * Look up capabilities for a model by its ID.
 * Order: exact match → family pattern → default.
 */
export function lookupModelCapability(modelId: string): ModelCapability {
  const lower = modelId.toLowerCase().trim();
  if (!lower) return { ...DEFAULT_CAPABILITY };

  // 1. Exact match
  for (const o of MODEL_OVERRIDES) {
    if (o.id.toLowerCase() === lower) return { ...o.capabilities };
  }

  // 2. Family pattern match (first wins)
  for (const f of FAMILY_RULES) {
    if (lower.includes(f.token.toLowerCase())) return { ...f.capabilities };
  }

  // 3. Guess vision from known vision tokens not covered above
  const visionTokens = ['vision', '-vl', ':vl', 'multimodal', 'vlm', '-vit'];
  if (visionTokens.some(t => lower.includes(t))) {
    return { ...DEFAULT_CAPABILITY, supportsVision: true, intelligenceRank: 55, speedRank: 55 };
  }

  // 4. Infer model type
  const type = inferModelType(modelId);

  // 5. Guess intelligence/speed from parameter count in the model name
  if (type === 'chat') {
    const paramGuess = guessParamsFromName(lower);
    if (paramGuess) {
      const intel = clamp(Math.round(20 + paramGuess * 0.7), 20, 88);
      const speed = clamp(Math.round(95 - paramGuess * 0.8), 10, 95);
      return { ...DEFAULT_CAPABILITY, type, intelligenceRank: intel, speedRank: speed };
    }
  }

  return { ...DEFAULT_CAPABILITY, type };
}

/**
 * Try to extract a rough parameter count from a model name.
 * Returns the estimated billions of parameters, or 0 if unguessable.
 */
function guessParamsFromName(name: string): number {
  // Pattern: "7b", "8b", "13b", "70b", "405b" etc.
  const match = name.match(/(\d+\.?\d*)\s*[bB]\b/);
  if (!match) return 0;
  const params = parseFloat(match[1]);
  if (isNaN(params) || params <= 0) return 0;

  // Some models use different naming: "8x7b" = 56B MoE, "8x22b" = 176B
  // But for simplicity we use the single-expert size; MoE is matched above.
  return params;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
