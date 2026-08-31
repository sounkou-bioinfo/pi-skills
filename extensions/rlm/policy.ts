import type { RlmContextKind, ThinkingLevel } from "./types.js";

export const RLM_LUNA_MODEL = "openai-codex/gpt-5.6-luna";
export const RLM_TERRA_MODEL = "openai-codex/gpt-5.6-terra";
export const RLM_SOL_MODEL = "openai-codex/gpt-5.6-sol";

/** Ordered by capability and price; do not infer prices beyond that ordering. */
export const RLM_MODEL_HIERARCHY = [RLM_LUNA_MODEL, RLM_TERRA_MODEL, RLM_SOL_MODEL] as const;
export type RlmModelTier = "luna" | "terra" | "sol";
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const satisfies readonly ThinkingLevel[];
export type RlmRole = "planner" | "worker" | "synthesis";

export const RLM_PROMPT_GUIDELINES = [
  "Use rlm with Luna for bounded extraction or simple work, Terra for multi-step analysis, planning, or synthesis, and Sol only for the hardest or high-stakes work; choose by semantic difficulty, not task keywords.",
  "Let rlm select thinking from the assigned model, role, and bounded context metadata; set thinking or subThinking only as a deliberate override, and reserve xhigh/max for explicit exceptional need.",
] as const;

export const RLM_MODEL_POLICY = "Model hierarchy and relative cost: Luna < Terra < Sol in capability and price. Use Luna for bounded extraction or simple work, Terra for multi-step analysis/planning/synthesis, and Sol only for the hardest or high-stakes work. Model and thinking assignments are fixed before each worker starts; a worker cannot self-escalate and must report insufficiency instead. xhigh and max thinking require an explicit caller choice.";

export function modelTier(model: string): RlmModelTier {
  const id = model.toLowerCase().replace(/:(?:off|minimal|low|medium|high|xhigh|max)$/, "");
  if (/(?:^|\/)gpt-5\.6-sol$/.test(id)) return "sol";
  if (/(?:^|\/)gpt-5\.6-terra$/.test(id)) return "terra";
  return "luna";
}

/** Resolve effort solely from declared model tier, role, and context metadata. */
export function resolveThinkingLevel(input: {
  explicit?: ThinkingLevel;
  model: string;
  role: RlmRole;
  contextKind: RlmContextKind;
  contextChars: number;
}): ThinkingLevel {
  if (input.explicit) return input.explicit;
  const tier = modelTier(input.model);
  if (input.role === "planner") return tier === "sol" ? "high" : "medium";
  if (input.role === "synthesis") return tier === "luna" ? "low" : tier === "terra" ? "medium" : "high";
  const bounded = (input.contextKind === "text" || input.contextKind === "csv") && input.contextChars <= 12_000;
  if (tier === "luna") return bounded ? "minimal" : "low";
  if (tier === "terra") return bounded ? "low" : "medium";
  return bounded ? "medium" : "high";
}

export function resolveNodePolicy(input: {
  depth: number;
  model: string;
  subModel: string;
  thinking?: ThinkingLevel;
  subThinking?: ThinkingLevel;
  role: RlmRole;
  contextKind: RlmContextKind;
  contextChars: number;
}): { model: string; thinking: ThinkingLevel } {
  const child = input.depth > 0;
  const model = child ? input.subModel : input.model;
  return {
    model,
    thinking: resolveThinkingLevel({
      explicit: child ? input.subThinking : input.thinking,
      model,
      role: input.role,
      contextKind: input.contextKind,
      contextChars: input.contextChars,
    }),
  };
}
