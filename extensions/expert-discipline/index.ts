import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Byte-stable guidance; each block is its own named prompt section. */
export const EXPERT_DISCIPLINE_BLOCK = `Expert decision discipline: for every consequential choice, apply the standards of a leading expert in the relevant field. Identify the strongest applicable reason that expert would reject the current candidate; if it applies, reject that candidate. Prefer what the expert would judge correct while honoring explicit user constraints, rather than merely choosing the cheapest constraint-satisfying option. State the decision, supporting evidence, uncertainty, and every material trade-off (including cost, risk, reversibility, scope, and alternatives). Keep private deliberation private: report concise conclusions and evidence, not hidden chain-of-thought. Do not claim certainty beyond the evidence. Prefer short observe-act-inspect-revise cycles to best-of-N answers. Do not run independent models on one unchanged question merely to rank outputs; delegate distinct evidence-producing subproblems, revisit with new evidence, or honor user-requested comparisons.`;

/** Compact activation guidance; the full workflow stays in the discovered skill. */
export const ARCHITECTURE_REFINEMENT_BLOCK = `When architecture-refinement is available in the skill list, proactively read and apply it for consequential design or implementation choices, uncertain requirements, technical issue refinement, surprising behavior, or code that has outrun understanding. Do not wait for the user to name the skill. Use its listed file location, including outside this repository. Bring our R-developer EDA ethos: inspect concrete behavior, make a small safe probe, and let evidence refine both the question and the code. Work toward a theory the owner can explain and modify, not a complete specification ahead of learning. Preserve accepted constraints and user authority. Keep the next step bounded by what can be understood and verified; routine mechanical edits do not need an architecture ceremony.`;

/**
 * Pi renders each section in its own tag and records it in the transcript, so
 * the rest of the prompt stays structured and a later change is sent as a
 * section update. Returning a whole `systemPrompt` would make the prompt opaque.
 */
export const PROMPT_SECTIONS = {
  expert_decision_discipline: EXPERT_DISCIPLINE_BLOCK,
  architecture_refinement: ARCHITECTURE_REFINEMENT_BLOCK,
} as const;

export default function extension(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event) => {
    Object.assign(event.systemPromptOptions.sections, PROMPT_SECTIONS);
  });
}
