import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const MANDATORY_SKILLS_MARKER = "<!-- pi-mandatory-skills:v1 -->";
export const MANDATORY_SKILL_NAMES = ["no-ghosts", "native-tool-discipline"] as const;
export const MANDATORY_SKILLS = MANDATORY_SKILL_NAMES.map((name) => ({
  name,
  source: readFileSync(new URL(`../../skills/${name}/SKILL.md`, import.meta.url), "utf8").trim(),
}));
export const MANDATORY_SKILLS_BLOCK = `${MANDATORY_SKILLS_MARKER}
${MANDATORY_SKILLS.map(
  ({ name, source }) => `<mandatory_skill name="${name}">
${source}
</mandatory_skill>`,
).join("\n")}`;

export function appendMandatorySkills(systemPrompt: string): string {
  if (systemPrompt.includes(MANDATORY_SKILLS_MARKER)) return systemPrompt;
  return `${systemPrompt}\n\n${MANDATORY_SKILLS_BLOCK}`;
}

export default function extension(pi: ExtensionAPI): void {
  pi.on("before_agent_start", async (event) => ({
    systemPrompt: appendMandatorySkills(event.systemPrompt),
  }));
}
