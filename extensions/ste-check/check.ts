// Structural checks for ASD-STE100 Simplified Technical English. Rule numbers
// refer to skills/simplified-technical-english/references/writing-rules.md.

export type Mode = "procedural" | "descriptive" | "mixed";
export type Finding = { level: "error" | "warning"; location: string; rule: string; message: string };
export type Check = { findings: Finding[]; unknown: string[] };
/**
 * `approved` is the STE dictionary; without it, the vocabulary is not checked.
 * `technical` gives the technical names and technical verbs of the subject.
 */
export type Words = { approved?: Set<string>; technical?: Set<string> };

export const MODES: readonly Mode[] = ["procedural", "descriptive", "mixed"];

// Rule 3.5: the only approved "-ing" words in the STE dictionary.
const ING_APPROVED = new Set(["mating", "missing", "remaining", "lighting", "opening", "routing", "servicing", "during"]);

// Words that end in "ing" where "ing" is not a verb suffix.
const ING_NOT_SUFFIX = new Set([
  "ring", "spring", "string", "king", "thing", "wing", "sing", "bring", "sting", "swing",
  "nothing", "anything", "everything", "something", "bearing", "ceiling", "morning", "evening",
]);

// Rule 3.2 and the dictionary: the approved helping verbs are CAN, MUST, WILL.
const BANNED_MODALS = new Set(["should", "would", "may", "might", "shall", "ought"]);

const WORD_LIMIT: Record<Mode, number> = { procedural: 20, descriptive: 25, mixed: 25 };

// Word boundaries for all letters and digits, not only ASCII.
const WORD = "[\\p{L}\\p{N}_]";
const START = `(?<!${WORD})`;
const END = `(?!${WORD})`;
const phrase = (source: string): RegExp => new RegExp(source, "iu");

// Verb structures that give one error for the first match in a sentence.
const VERB_STRUCTURES: ReadonlyArray<{ rule: string; pattern: RegExp; message: (match: string) => string }> = [
  {
    rule: "4.2",
    pattern: phrase(`${START}${WORD}+n't${END}|${START}${WORD}+'(?:re|ll|ve|m)${END}|${START}(?:it|that|there|what|let|who|here|he|she)'s${END}`),
    message: (match) => `contraction "${match}": write the full words.`,
  },
  {
    rule: "3.4",
    pattern: phrase(
      `${START}(?:has|have|had)\\s+(?:been|${WORD}+ed|done|made|gone|put|set|cut|kept|held|taken|given|found|left|lost|meant|sent|shown|told|built|become|begun|broken|brought|come|fallen|felt|got|gotten|grown|known|read|run|seen|spoken|thrown|worn|written)${END}`,
    ),
    message: (match) => `helping verb structure "${match}": use the simple past tense.`,
  },
  {
    rule: "3.4",
    pattern: phrase(
      `${START}(?:can|will|must|could|would|should|may|might|shall)\\s+(?:not\\s+)?be\\s+${WORD}+(?:ed|en)${END}|${START}(?:is|are|was|were)\\s+to\\s+be\\s+${WORD}+(?:ed|en)${END}`,
    ),
    message: (match) => `complex passive "${match}": make the sentence active.`,
  },
  {
    rule: "3.6",
    pattern: phrase(`${START}(?:is|are|was|were|be|been|being)\\s+(?:${WORD}+\\s+)?${WORD}+(?:ed|en)\\s+by${END}`),
    message: (match) => `passive voice "${match}": make the agent the subject.`,
  },
];
const PROGRESSIVE = phrase(`${START}(?:is|are|was|were|be|been|am)\\s+${WORD}+ing${END}`);

const WORDISH = /[A-Za-z0-9'&/’-]+/g;
const HAS_WORDISH = /[A-Za-z0-9'&/’-]/;
const SENTENCE_BREAK = /(?<=[.!?:])\s+/;
const LIST_MARKER = /^\s*(?:[-*+]|\p{Nd}+\.)\s+/u;
const WORD_LIST_ENTRY = /^([A-Z][A-Z' -]*[A-Z])\s+\(([\p{L}\p{N}_]+(?:, [\p{L}\p{N}_]+)*)\)(?:\s+\[(.*)\])?/u;

/** Remove the parts of the text that the STE rules do not control. */
function stripMarkdown(text: string): string {
  return text
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]+`/g, " CODE ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " URL ")
    .replace(/^>.*$/gm, " ")
    // Rule 8.6: quoted text counts as one word.
    .replace(/"[^"\n]*"|“[^”\n]*”/g, " QUOTED ");
}

/**
 * Section 8: a number, an identifier, a hyphenated group, and text in
 * parentheses each count as one word.
 */
function countWords(sentence: string): number {
  const text = sentence.replace(/\([^)]*\)/g, " PAREN ").replace(/\*\*|\*|__|_|#+/g, " ");
  return text.match(WORDISH)?.length ?? 0;
}

function sentences(block: string): string[] {
  return block.split(SENTENCE_BREAK).map((part) => part.trim()).filter((part) => HAS_WORDISH.test(part));
}

/** The word forms of a `WORD (part of speech) [forms]` list, with the plurals of the nouns. */
export function loadWordList(source: string): Set<string> {
  const approved = new Set<string>();
  for (const line of source.split(/\r?\n/)) {
    const entry = WORD_LIST_ENTRY.exec(line);
    if (!entry) continue;
    const head = entry[1].toLowerCase();
    for (const word of `${head} ${entry[3] ?? ""}`.toLowerCase().split(/[\s,]+/)) if (word) approved.add(word);
    if (!line.includes("(n)")) continue;
    approved.add(`${head}s`);
    if (/(?:s|x|ch|sh)$/.test(head)) approved.add(`${head}es`);
    if (/[^aeiou]y$/.test(head)) approved.add(`${head.slice(0, -1)}ies`);
  }
  return approved;
}

function checkSentence(sentence: string, mode: Mode, location: string, technical?: Set<string>): Finding[] {
  const findings: Finding[] = [];
  const error = (rule: string, message: string) => findings.push({ level: "error", location, rule, message });
  const warning = (rule: string, message: string) => findings.push({ level: "warning", location, rule, message });

  const characters = [...sentence];
  const shown = characters.length <= 60 ? sentence : `${characters.slice(0, 57).join("")}...`;
  const count = countWords(sentence);
  if (count > 25) error("5.1/6.3", `sentence has ${count} words (max ${WORD_LIMIT[mode]}): "${shown}"`);
  else if (count > 20 && mode === "procedural") error("5.1", `sentence has ${count} words (max 20): "${shown}"`);
  else if (count > 20 && mode === "mixed") warning("5.1", `sentence has ${count} words (max 20 if procedural): "${shown}"`);

  if (sentence.includes(";")) error("8.1", `semicolon found: "${shown}". Write two sentences.`);
  for (const structure of VERB_STRUCTURES) {
    const match = structure.pattern.exec(sentence);
    if (match) error(structure.rule, structure.message(match[0]));
  }
  const progressive = PROGRESSIVE.exec(sentence);
  if (progressive && !ING_APPROVED.has(progressive[0].split(/\s+/).at(-1)!.toLowerCase())) {
    error("3.5", `progressive form "${progressive[0]}": use a simple tense.`);
  }

  for (const word of sentence.match(/[A-Za-z-]+/g) ?? []) {
    const lower = word.toLowerCase();
    const allCapitals = /[A-Z]/.test(word) && !/[a-z]/.test(word);
    if (BANNED_MODALS.has(lower)) {
      error("3.2", `"${word}" is not approved. Use "must" (requirement), "can" (possibility), "will" (future), or remove it.`);
    } else if (lower === "could") {
      warning("3.2", `"could" is approved only as the past tense of "can".`);
    } else if (lower.endsWith("ing") && lower.length > 4 && !allCapitals && !ING_APPROVED.has(lower) && !ING_NOT_SUFFIX.has(lower) && !technical?.has(lower)) {
      warning("3.5", `"${word}": an "-ing" form is permitted only in a technical name.`);
    }
  }
  return findings;
}

/** Words that are not approved. Acronyms and identifiers are technical names. */
function unknownWords(text: string, approved: Set<string>, technical?: Set<string>): string[] {
  const known = (word: string) => approved.has(word) || technical?.has(word) === true;
  const unknown: string[] = [];
  for (const word of text.match(/[A-Za-z]+(?:-[A-Za-z]+)*/g) ?? []) {
    if (word.length <= 1 || /^.+[A-Z]/.test(word)) continue;
    const lower = word.toLowerCase();
    if (ING_APPROVED.has(lower) || known(lower) || lower.split("-").every(known)) continue;
    unknown.push(lower);
  }
  return unknown;
}

/** Check Markdown or plain text. `name` starts each finding location. */
export function checkText(text: string, mode: Mode, name: string, { approved, technical }: Words = {}): Check {
  const findings: Finding[] = [];
  const unknown: string[] = [];
  const paragraphs = stripMarkdown(text.replace(/\r\n?/g, "\n")).split(/\n\s*\n/);
  paragraphs.forEach((raw, index) => {
    const paragraph = raw.trim();
    // Rule 8.6: a heading or a table row is a title or quoted text.
    if (!HAS_WORDISH.test(paragraph) || /^[#|]/.test(paragraph)) return;
    const lines = paragraph.split("\n");
    const items = lines.filter((line) => LIST_MARKER.test(line)).map((line) => line.replace(LIST_MARKER, ""));
    const prose = lines.filter((line) => !LIST_MARKER.test(line)).join("\n");

    // Rule 8.4: a list item is checked as its own sentences, apart from the
    // sentence count of the paragraph.
    for (const item of items) {
      for (const sentence of sentences(item)) findings.push(...checkSentence(sentence, mode, `${name}:list`, technical));
    }
    const location = `${name}:par${index + 1}`;
    const proseSentences = sentences(prose);
    if (proseSentences.length > 6) {
      findings.push({ level: "error", location, rule: "6.6", message: `paragraph has ${proseSentences.length} sentences (max 6).` });
    }
    for (const sentence of proseSentences) findings.push(...checkSentence(sentence, mode, location, technical));
    if (approved?.size) unknown.push(...unknownWords([...items, prose].join("\n"), approved, technical));
  });
  return { findings, unknown };
}

/** Errors, then warnings, then the unknown words by count and first use. */
export function formatReport(checks: readonly Check[]): string {
  const findings = checks.flatMap((check) => check.findings);
  const errors = findings.filter((finding) => finding.level === "error");
  const warnings = findings.filter((finding) => finding.level === "warning");
  const counts = new Map<string, number>();
  for (const word of checks.flatMap((check) => check.unknown)) counts.set(word, (counts.get(word) ?? 0) + 1);
  const words = [...counts.keys()].sort((left, right) => counts.get(right)! - counts.get(left)!);

  const lines = [
    ...errors.map((finding) => `ERROR   ${finding.location} [rule ${finding.rule}] ${finding.message}`),
    ...warnings.map((finding) => `WARNING ${finding.location} [rule ${finding.rule}] ${finding.message}`),
  ];
  if (words.length > 0) {
    lines.push(`\nCHECK   ${words.length} words are not in the approved word list.`);
    lines.push("        Each must be an approved technical name or technical verb:");
    for (let start = 0; start < words.length; start += 10) lines.push(`        ${words.slice(start, start + 10).join(", ")}`);
  }
  lines.push(`\nResult: ${errors.length} errors, ${warnings.length} warnings.`);
  if (errors.length === 0) {
    lines.push("The text obeys the STE structural rules that this tool can check.");
    lines.push("This tool cannot make sure that each word has its approved meaning.");
  }
  return lines.join("\n");
}
