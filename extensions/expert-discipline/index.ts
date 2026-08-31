import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const EXPERT_DISCIPLINE_MARKER = "<!-- pi-expert-decision-discipline:v1 -->";

/** Byte-stable guidance appended once to the chained system prompt. */
export const EXPERT_DISCIPLINE_BLOCK = `${EXPERT_DISCIPLINE_MARKER}
Expert decision discipline: for every consequential choice, apply the standards of a leading expert in the relevant field. Identify the strongest applicable reason that expert would reject the current candidate; if it applies, reject that candidate. Prefer what the expert would judge correct while honoring explicit user constraints, rather than merely choosing the cheapest constraint-satisfying option. State the decision, supporting evidence, uncertainty, and every material trade-off (including cost, risk, reversibility, scope, and alternatives). Keep private deliberation private: report concise conclusions and evidence, not hidden chain-of-thought. Do not claim certainty beyond the evidence.`;

/** Preserve the base prompt exactly and append the discipline block at most once. */
export function appendExpertDiscipline(systemPrompt: string): string {
  if (systemPrompt.includes(EXPERT_DISCIPLINE_MARKER)) return systemPrompt;
  return `${systemPrompt}\n\n${EXPERT_DISCIPLINE_BLOCK}`;
}

export default function extension(pi: ExtensionAPI): void {
  pi.on("before_agent_start", async (event) => ({
    systemPrompt: appendExpertDiscipline(event.systemPrompt),
  }));
}
