import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const EXPERT_DISCIPLINE_MARKER = "<!-- pi-expert-decision-discipline:v1 -->";

/** Byte-stable guidance appended once to the chained system prompt. */
export const EXPERT_DISCIPLINE_BLOCK = `${EXPERT_DISCIPLINE_MARKER}
Expert decision discipline: for every consequential choice, apply the standards of a leading expert in the relevant field. Identify the strongest applicable reason that expert would reject the current candidate; if it applies, reject that candidate. Prefer what the expert would judge correct while honoring explicit user constraints, rather than merely choosing the cheapest constraint-satisfying option. State the decision, supporting evidence, uncertainty, and every material trade-off (including cost, risk, reversibility, scope, and alternatives). Keep private deliberation private: report concise conclusions and evidence, not hidden chain-of-thought. Do not claim certainty beyond the evidence.`;

/** Compact activation guidance; the full workflow stays in the discovered skill. */
export const ARCHITECTURE_REFINEMENT_MARKER = "<!-- pi-architecture-refinement-nudge:v1 -->";

export const ARCHITECTURE_REFINEMENT_BLOCK = `${ARCHITECTURE_REFINEMENT_MARKER}
When architecture-refinement is available in the skill list, proactively read and apply it for consequential design or implementation choices, uncertain requirements, technical issue refinement, surprising behavior, or code that has outrun understanding. Do not wait for the user to name the skill. Use its listed file location, including outside this repository. Bring our R-developer EDA ethos: inspect concrete behavior, make a small safe probe, and let evidence refine both the question and the code. Work toward a theory the owner can explain and modify, not a complete specification ahead of learning. Preserve accepted constraints and user authority. Keep the next step bounded by what can be understood and verified; routine mechanical edits do not need an architecture ceremony.`;

/** Preserve the base prompt exactly and append each policy block at most once. */
export function appendExpertDiscipline(systemPrompt: string): string {
  let result = systemPrompt;
  if (!result.includes(EXPERT_DISCIPLINE_MARKER)) result += `\n\n${EXPERT_DISCIPLINE_BLOCK}`;
  if (!result.includes(ARCHITECTURE_REFINEMENT_MARKER)) result += `\n\n${ARCHITECTURE_REFINEMENT_BLOCK}`;
  return result;
}

export default function extension(pi: ExtensionAPI): void {
  pi.on("before_agent_start", async (event) => ({
    systemPrompt: appendExpertDiscipline(event.systemPrompt),
  }));
}
