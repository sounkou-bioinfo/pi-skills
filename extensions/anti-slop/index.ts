import { fileURLToPath } from "node:url";
import { isAbsolute, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const analyzerPath = fileURLToPath(new URL("../../scripts/anti_slop.R", import.meta.url));
const languageSchema = Type.Union([Type.Literal("auto"), Type.Literal("r"), Type.Literal("c")]);

const parameters = Type.Object({
  path: Type.String({ description: "R/C source file or directory to analyze. A Git directory scans its tracked R/C files under this path; other directories recurse over recognized source suffixes. Relative paths resolve from the current working directory." }),
  language: Type.Optional(languageSchema),
  config: Type.Optional(Type.String({ description: "Optional anti-slop JSON rule configuration. Relative paths resolve from the current working directory." })),
  max_findings: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000, description: "Maximum diagnostics to return (default: 100)." })),
  jarl: Type.Optional(Type.Boolean({ description: "Also run the installed Jarl R linter and namespace its diagnostics as jarl/<rule>. Disabled by default; set PI_ANTI_SLOP_JARL_BIN to override the executable." })),
});

type Params = {
  path: string;
  language?: "auto" | "r" | "c";
  config?: string;
  max_findings?: number;
  jarl?: boolean;
};

function absolutePath(cwd: string, path: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

async function analyze(pi: ExtensionAPI, ctx: ExtensionContext, params: Params, signal?: AbortSignal): Promise<string> {
  const path = absolutePath(ctx.cwd, params.path);
  const args = [analyzerPath, "--format", "text", "--language", params.language ?? "auto", "--max-findings", String(params.max_findings ?? 100)];
  if (params.config) args.push("--config", absolutePath(ctx.cwd, params.config));
  if (params.jarl) args.push("--jarl", process.env.PI_ANTI_SLOP_JARL_BIN || "jarl");
  args.push(path);

  const result = await pi.exec(process.env.PI_ANTI_SLOP_R_BIN || "Rscript", args, {
    cwd: ctx.cwd,
    signal,
    timeout: 60_000,
  });
  if (result.code !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(detail || `anti-slop analyzer exited with status ${result.code}`);
  }
  return result.stdout.trim() || "anti-slop produced no output";
}

export default function antiSlopExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "anti_slop",
    label: "Anti-slop",
    description:
      "Run the repository-vendored Tree-sitter anti-slop analyzer over one R/C source file or directory, optionally adding installed Jarl diagnostics. Directory runs count direct private-helper calls across their analysis scope. It has no regex or parser fallback: missing R grammars and syntax errors are reported explicitly.",
    parameters,
    async execute(_toolCallId, params: Params, signal, _onUpdate, ctx) {
      const output = await analyze(pi, ctx, params, signal);
      return {
        content: [{ type: "text", text: output }],
        details: { path: absolutePath(ctx.cwd, params.path), language: params.language ?? "auto", jarl: params.jarl ?? false },
      };
    },
  });

  pi.registerCommand("anti-slop", {
    description: "Analyze an R/C source file or directory; prefix the path with --jarl to include Jarl",
    handler: async (args, ctx) => {
      const input = args.trim();
      const jarlPrefix = /^--jarl(?:\s+|$)/.exec(input);
      const jarl = jarlPrefix !== null;
      const path = jarlPrefix ? input.slice(jarlPrefix[0].length).trim() : input;
      if (!path) {
        ctx.ui.notify("Usage: /anti-slop [--jarl] path/to/source.R, source.c, or a directory", "warning");
        return;
      }
      try {
        ctx.ui.notify(await analyze(pi, ctx, { path, jarl }), "info");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}
