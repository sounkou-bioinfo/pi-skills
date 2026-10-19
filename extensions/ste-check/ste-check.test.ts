import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { checkText, formatReport, loadWordList, type Mode } from "./check.js";
import steCheckExtension from "./index.js";

const skill = fileURLToPath(new URL("../../skills/simplified-technical-english/", import.meta.url));
const approved = loadWordList(await readFile(path.join(skill, "references/word-list.md"), "utf8"));
const technical = loadWordList(await readFile(path.join(skill, "references/bioinformatics-terms.md"), "utf8"));

function report(text: string, mode: Mode = "mixed", words?: Set<string>): string[] {
  return formatReport([checkText(text, mode, "draft", { approved: words })]).split("\n");
}

function rules(text: string, mode: Mode, level: "error" | "warning"): string[] {
  return checkText(text, mode, "draft").findings.filter((finding) => finding.level === level).map((finding) => finding.rule);
}

test("text without findings reports only the result", () => {
  assert.deepEqual(report("Remove the four bolts.", "procedural"), [
    "",
    "Result: 0 errors, 0 warnings.",
    "The text obeys the STE structural rules that this tool can check.",
    "This tool cannot make sure that each word has its approved meaning.",
  ]);
});

test("verb, punctuation, and helping-verb rules report their match in text order, errors before warnings", () => {
  const text = [
    "The operator has adjusted the linkage; it's ready.",
    "The circuits are connected by a relay.",
    "The valve must be closed.",
    "The pump is running.",
    "You should stop.",
  ].join("\n");
  assert.deepEqual(report(text), [
    `ERROR   draft:par1 [rule 8.1] semicolon found: "The operator has adjusted the linkage; it's ready.". Write two sentences.`,
    `ERROR   draft:par1 [rule 4.2] contraction "it's": write the full words.`,
    `ERROR   draft:par1 [rule 3.4] helping verb structure "has adjusted": use the simple past tense.`,
    `ERROR   draft:par1 [rule 3.6] passive voice "are connected by": make the agent the subject.`,
    `ERROR   draft:par1 [rule 3.4] complex passive "must be closed": make the sentence active.`,
    `ERROR   draft:par1 [rule 3.5] progressive form "is running": use a simple tense.`,
    `ERROR   draft:par1 [rule 3.2] "should" is not approved. Use "must" (requirement), "can" (possibility), "will" (future), or remove it.`,
    `WARNING draft:par1 [rule 3.5] "running": an "-ing" form is permitted only in a technical name.`,
    "",
    "Result: 7 errors, 1 warnings.",
  ]);
});

test("approved -ing words, non-suffix words, and capitalized names have no -ing finding", () => {
  const text = "The parts are missing. Do the servicing in the morning. TESTING the spring. He could go. Stop the testing.";
  assert.deepEqual(report(text).slice(0, 2), [
    `WARNING draft:par1 [rule 3.2] "could" is approved only as the past tense of "can".`,
    `WARNING draft:par1 [rule 3.5] "testing": an "-ing" form is permitted only in a technical name.`,
  ]);
  assert.deepEqual(rules(text, "mixed", "error"), []);
});

test("sentence limits depend on the mode and count groups as one word", () => {
  const sentence = (words: number) => `${"bolt ".repeat(words - 1)}end.`;
  assert.deepEqual(rules(sentence(20), "procedural", "error"), []);
  assert.deepEqual(rules(sentence(21), "procedural", "error"), ["5.1"]);
  assert.deepEqual(rules(sentence(21), "descriptive", "error"), []);
  assert.deepEqual(rules(sentence(21), "mixed", "warning"), ["5.1"]);
  assert.deepEqual(rules(sentence(26), "descriptive", "error"), ["5.1/6.3"]);
  assert.deepEqual(rules(`${"bolt ".repeat(18)}(a long group in parentheses) torque-wrench-set.`, "procedural", "error"), []);
});

test("a paragraph has a sentence limit and list items are checked as their own sentences", () => {
  const text = [
    "One bolt. Two bolts. Three bolts. Four bolts. Five bolts. Six bolts. Seven bolts.",
    "",
    "- Remove the bolt. You should stop.",
    "- Item two. Item three. Item four. Item five. Item six. Item seven. Item eight.",
    "1. Don't stop.",
  ].join("\n");
  assert.deepEqual(report(text).slice(0, 3), [
    "ERROR   draft:par1 [rule 6.6] paragraph has 7 sentences (max 6).",
    `ERROR   draft:list [rule 3.2] "should" is not approved. Use "must" (requirement), "can" (possibility), "will" (future), or remove it.`,
    `ERROR   draft:list [rule 4.2] contraction "Don't": write the full words.`,
  ]);
  assert.equal(rules(text, "mixed", "error").length, 3);
});

test("frontmatter, headings, table rows, block quotes, code, link targets, URLs, and quoted text are not checked", () => {
  const text = [
    "---",
    "description: You should; don't.",
    "---",
    "",
    "# Heading should; be free",
    "",
    "| Cell | should; |",
    "",
    "> A quotation should; stay.",
    "",
    "```",
    "should; don't",
    "```",
    "",
    'Use `should;` and [the page](https://example.com/should;) and "should; text" and “should; text”.',
    "Refer to https://example.com/should;x for data.",
  ].join("\r\n");
  assert.deepEqual(checkText(text, "mixed", "draft").findings, []);
});

test("unknown words are listed by count, then first use, without acronyms, identifiers, noun plurals, or hyphenated approved words", () => {
  const text = [
    "The gizmo and the gizmo and the widget are near the tests.",
    "",
    "The API and the camelCase name and the X are approved. Add the names.",
    "- The widget and the gizmo and the zap-test and the frob and the on-off name are here.",
  ].join("\n");
  assert.deepEqual(report(text, "mixed", approved).slice(0, 4), [
    "",
    "CHECK   4 words are not in the approved word list.",
    "        Each must be an approved technical name or technical verb:",
    "        gizmo, widget, zap-test, frob",
  ]);
  assert.deepEqual(checkText(text, "mixed", "draft").unknown, []);
});

test("a word list gives its verb forms and noun plurals, and unknown words show in rows of ten", () => {
  const words = loadWordList("# Words\nZAP (v) [ZAPS, ZAPPED]\nTHE (art)\nFIX (n)\nPLY (n)\nnot an entry (n)\n");
  assert.deepEqual([...words].sort(), ["fix", "fixes", "fixs", "plies", "ply", "plys", "the", "zap", "zapped", "zaps"]);
  assert.deepEqual(checkText("Zapped the fixes. Zap the plies. Zaps the fix twice.", "mixed", "draft", { approved: words }).unknown, ["twice"]);
  const eleven = "zza zzb zzc zzd zze zzf zzg zzh zzi zzj zzk";
  assert.deepEqual(report(eleven, "mixed", words).slice(3, 5), ["        zza, zzb, zzc, zzd, zze, zzf, zzg, zzh, zzi, zzj", "        zzk"]);
});

test("bioinformatics technical names and verbs are known words, and their -ing names have no warning", () => {
  const text = "Sort the BAM file and call the variants. The sequencing run gives paired-end reads and k-mers for many loci. Stop the trimming of the gizmo.";
  const result = checkText(text, "procedural", "draft", { approved, technical });
  assert.deepEqual(result.unknown, ["trimming", "gizmo"]);
  assert.deepEqual(result.findings.map((finding) => finding.message), [`"trimming": an "-ing" form is permitted only in a technical name.`]);
  assert.deepEqual(rules("The sequencer is sequencing the library.", "mixed", "error"), ["3.5"]);

  const plain = checkText(text, "procedural", "draft", { approved });
  assert.deepEqual(plain.unknown, ["sort", "file", "call", "variants", "sequencing", "run", "paired-end", "k-mers", "loci", "trimming", "gizmo"]);
  assert.deepEqual(plain.findings.map((finding) => finding.rule), ["3.5", "3.5"]);
});

test("several checks report together with each finding named by its source", () => {
  const combined = formatReport([checkText("You should stop.", "mixed", "first.md"), checkText("One.\n\nDon't stop.", "mixed", "second.md")]);
  assert.match(combined, /^ERROR   first\.md:par1 \[rule 3\.2\].*\nERROR   second\.md:par2 \[rule 4\.2\].*\n\nResult: 2 errors, 0 warnings\.$/);
});

test("the skill text obeys its own structural rules", async () => {
  for (const document of ["SKILL.md", "examples/before-after.md", "examples/bioinformatics.md", "references/substitutions.md", "references/bioinformatics.md"]) {
    const result = checkText(await readFile(path.join(skill, document), "utf8"), "mixed", document, { approved, technical });
    assert.deepEqual(result.findings.filter((finding) => finding.level === "error"), [], document);
  }
});

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  details: { source: string; mode: Mode; errors: number; warnings: number; unknown_words: number };
};
type Params = { path?: string; text?: string; mode?: Mode; vocabulary?: boolean };
type RegisteredTool = {
  execute: (toolCallId: string, params: Params, signal: undefined, onUpdate: undefined, ctx: ExtensionContext) => Promise<ToolResult>;
};
type RegisteredCommand = { handler: (args: string, ctx: ExtensionContext) => Promise<void> };

test("the tool and the command check files from the working directory and draft text with the skill word list", async () => {
  let tool: RegisteredTool | undefined;
  let command: RegisteredCommand | undefined;
  steCheckExtension({
    registerTool(definition: unknown) {
      tool = definition as RegisteredTool;
    },
    registerCommand(name: string, definition: unknown) {
      assert.equal(name, "ste-check");
      command = definition as RegisteredCommand;
    },
  } as unknown as ExtensionAPI);
  assert.ok(tool);
  assert.ok(command);

  const cwd = await mkdtemp(path.join(tmpdir(), "ste-check-test-"));
  try {
    await writeFile(path.join(cwd, "draft.md"), `${"bolt ".repeat(20)}end. You should examine the gizmo.\n`);
    const notifications: Array<{ message: string; level: string }> = [];
    const ctx = { cwd, ui: { notify: (message: string, level: string) => notifications.push({ message, level }) } } as unknown as ExtensionContext;
    const run = (params: Params) => tool!.execute("call", params, undefined, undefined, ctx);

    const file = await run({ path: "draft.md", mode: "procedural" });
    assert.deepEqual(file.details, { source: path.join(cwd, "draft.md"), mode: "procedural", errors: 2, warnings: 0, unknown_words: 3 });
    assert.match(file.content[0].text, /^ERROR   draft\.md:par1 \[rule 5\.1\] sentence has 21 words \(max 20\)/);
    assert.match(file.content[0].text, /CHECK   3 words are not in the approved word list.\n.*\n        bolt, should, gizmo\n/);

    const draft = await run({ text: "Examine the gizmo.", vocabulary: false });
    assert.deepEqual(draft.details, { source: "text", mode: "mixed", errors: 0, warnings: 0, unknown_words: 0 });
    assert.doesNotMatch(draft.content[0].text, /CHECK/);

    await assert.rejects(run({}), /either path or text/);
    await assert.rejects(run({ path: "draft.md", text: "Stop." }), /either path or text/);
    await assert.rejects(run({ path: "absent.md" }), /ENOENT/);

    await command.handler("--mode descriptive draft.md", ctx);
    await command.handler("--mode poem draft.md", ctx);
    await command.handler("", ctx);
    await command.handler("absent.md", ctx);
    assert.deepEqual(notifications.map((notification) => notification.level), ["warning", "warning", "warning", "error"]);
    assert.match(notifications[0].message, /Result: 1 errors, 0 warnings\.$/);
    assert.match(notifications[1].message, /^Usage: \/ste-check/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
