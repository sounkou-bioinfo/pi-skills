import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { MODES, checkText, formatReport, loadWordList, type Mode } from "./check.js";

const references = new URL("../../skills/simplified-technical-english/references/", import.meta.url);
const readWords = (file: string): Promise<Set<string>> => readFile(new URL(file, references), "utf8").then(loadWordList);
const modeSchema = Type.Union([Type.Literal("procedural"), Type.Literal("descriptive"), Type.Literal("mixed")]);

const parameters = Type.Object({
  path: Type.Optional(Type.String({ description: "Markdown or text file to check. Relative paths resolve from the current working directory. Give either path or text." })),
  text: Type.Optional(Type.String({ description: "Draft text to check in place of a file." })),
  mode: Type.Optional(modeSchema),
  vocabulary: Type.Optional(Type.Boolean({ description: "List the words that are not in the approved word list or the bioinformatics term list (default: true)." })),
});

type Params = { path?: string; text?: string; mode?: Mode; vocabulary?: boolean };
type Details = { source: string; mode: Mode; errors: number; warnings: number; unknown_words: number };

let approvedWords: Promise<Set<string>> | undefined;
let technicalWords: Promise<Set<string>> | undefined;

async function check(ctx: ExtensionContext, params: Params): Promise<{ report: string; details: Details }> {
  if ((params.path === undefined) === (params.text === undefined)) throw new Error("ste_check needs either path or text");
  const mode = params.mode ?? "mixed";
  const source = params.path === undefined ? "text" : isAbsolute(params.path) ? params.path : resolve(ctx.cwd, params.path);
  const text = params.text ?? (await readFile(source, "utf8"));
  const approved = params.vocabulary === false ? undefined : await (approvedWords ??= readWords("word-list.md"));
  const technical = await (technicalWords ??= readWords("bioinformatics-terms.md"));
  const result = checkText(text, mode, params.path ?? "text", { approved, technical });
  const errors = result.findings.filter((finding) => finding.level === "error").length;
  return {
    report: formatReport([result]),
    details: { source, mode, errors, warnings: result.findings.length - errors, unknown_words: new Set(result.unknown).size },
  };
}

export default function steCheckExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "ste_check",
    label: "STE check",
    description:
      "Check a Markdown or text file, or draft text, against the structural rules of Simplified Technical English (ASD-STE100): sentence and paragraph length, verb forms, passive voice, contractions, semicolons, helping verbs, and words outside the approved word list and the bioinformatics technical names and verbs of the skill. Use mode procedural for instructions (maximum 20 words in a sentence) and descriptive for explanations (maximum 25). Code, URLs, quoted text, headings, and table rows are not checked. The tool cannot know if a word has its approved meaning.",
    parameters,
    async execute(_toolCallId, params: Params, _signal, _onUpdate, ctx) {
      const { report, details } = await check(ctx, params);
      return { content: [{ type: "text", text: report }], details };
    },
  });

  pi.registerCommand("ste-check", {
    description: "Check a Markdown or text file against the Simplified Technical English rules; prefix the path with --mode procedural|descriptive",
    handler: async (args, ctx) => {
      const option = /^--mode[=\s]+(\S+)\s*/.exec(args.trim());
      const path = option ? args.trim().slice(option[0].length) : args.trim();
      if (!path || (option && !MODES.includes(option[1] as Mode))) {
        ctx.ui.notify("Usage: /ste-check [--mode procedural|descriptive|mixed] path/to/text.md", "warning");
        return;
      }
      try {
        const { report, details } = await check(ctx, { path, mode: option?.[1] as Mode | undefined });
        ctx.ui.notify(report.trim(), details.errors > 0 ? "warning" : "info");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}
