import { getCurrentSystemMessage, type SystemMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Byte-stable guidance; each block is its own named prompt section. */
export const EXPERT_DISCIPLINE_BLOCK = `Expert decision discipline: for every consequential choice, apply the standards of a leading expert in the relevant field. Identify the strongest applicable reason that expert would reject the current candidate; if it applies, reject that candidate. Prefer what the expert would judge correct while honoring explicit user constraints, rather than merely choosing the cheapest constraint-satisfying option. State the decision, supporting evidence, uncertainty, and every material trade-off (including cost, risk, reversibility, scope, and alternatives). Keep private deliberation private: report concise conclusions and evidence, not hidden chain-of-thought. Do not claim certainty beyond the evidence. Prefer short observe-act-inspect-revise cycles to best-of-N answers. Do not run independent models on one unchanged question merely to rank outputs; delegate distinct evidence-producing subproblems, revisit with new evidence, or honor user-requested comparisons.`;

/** Compact activation guidance; the full workflow stays in the discovered skill. */
export const ARCHITECTURE_REFINEMENT_BLOCK = `When architecture-refinement is available in the skill list, proactively read and apply it for consequential design or implementation choices, uncertain requirements, technical issue refinement, surprising behavior, or code that has outrun understanding. Do not wait for the user to name the skill. Use its listed file location, including outside this repository. Bring our R-developer EDA ethos: inspect concrete behavior, make a small safe probe, and let evidence refine both the question and the code. Work toward a theory the owner can explain and modify, not a complete specification ahead of learning. Preserve accepted constraints and user authority. Keep the next step bounded by what can be understood and verified; routine mechanical edits do not need an architecture ceremony.`;

/** Clarification applies even when the architecture skill is unavailable. */
export const CLARIFICATION_GATE_BLOCK = `Before consequential analysis, execution, or edits, pause affected work when intent has materially different plausible readings, constraints conflict, or a correction exposes an unresolved assumption. Clarify whether examples are analogies, acceptance cases, or constraints when this changes design or verification. Resolve factual gaps with bounded inspection and safe probes that do not commit to an interpretation; tests cannot decide intent. Ask one focused question: give alternatives, consequences, and a recommendation, not assumed approval. Wait for resolution or explicit delegation within accepted constraints; a generic continue is not resolution. If the user is absent, report the pending choice and keep affected work paused. Proceed on settled decisions, scoped delegation, or routine work without a material intent fork. Revisit settled decisions only when evidence, changed constraints, or corrections invalidate their premises. Do not manufacture ambiguity or demand a full specification.`;

/**
 * Pi renders each section in its own tag and records it in the transcript, so
 * the rest of the prompt stays structured and a later change is sent as a
 * section update. Returning a whole `systemPrompt` would make the prompt opaque.
 */
export const PROMPT_SECTIONS = {
  expert_decision_discipline: EXPERT_DISCIPLINE_BLOCK,
  architecture_refinement: ARCHITECTURE_REFINEMENT_BLOCK,
  clarification_gate: CLARIFICATION_GATE_BLOCK,
} as const;

export default function extension(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event) => {
    Object.assign(event.systemPromptOptions.sections, PROMPT_SECTIONS);
  });

  // Background continuations can bypass before_agent_start. Repair the outgoing
  // projection only, preserving stored history, unrelated sections, and tools.
  pi.on("context_with_system", (event) => {
    const current = getCurrentSystemMessage(event.messages)?.sections;
    const sections: Record<string, string> = {};
    for (const [name, block] of Object.entries(PROMPT_SECTIONS)) {
      const rendered = `<${name}>\n${block}\n</${name}>`;
      if (current?.[name] !== rendered) sections[name] = rendered;
    }
    if (Object.keys(sections).length === 0) return;
    const update: SystemMessage = { role: "system", content: "", sections, timestamp: 0 };
    return { messages: [...event.messages, update] };
  });
}
