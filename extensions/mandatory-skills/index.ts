import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const MANDATORY_SKILL_NAMES = ["no-ghosts", "native-tool-discipline"] as const;
export const MANDATORY_SKILLS = MANDATORY_SKILL_NAMES.map((name) => ({
  name,
  source: readFileSync(new URL(`../../skills/${name}/SKILL.md`, import.meta.url), "utf8").trim(),
}));
export const MANDATORY_SKILLS_BLOCK = MANDATORY_SKILLS.map(
  ({ name, source }) => `<mandatory_skill name="${name}">
${source}
</mandatory_skill>`,
).join("\n");

/** A named prompt section keeps the rest of the prompt structured for Pi. */
export const MANDATORY_SKILLS_SECTION = "mandatory_skills";

export default function extension(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event) => {
    event.systemPromptOptions.sections[MANDATORY_SKILLS_SECTION] = MANDATORY_SKILLS_BLOCK;
  });
}
