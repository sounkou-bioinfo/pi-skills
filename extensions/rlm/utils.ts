export function qualifyModel(model: string): string {
  return model.includes("/") ? model : `openai-codex/${model}`;
}

export function shortText(text: string, maxChars = 160): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 3)}...`;
}

export function normalizeTask(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

export function safeJsonParse<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

export function extractFirstJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

export function chunkText(text: string, chunkSize: number): string[] {
  if (text.length <= chunkSize) return [text];
  const chunks: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    let end = Math.min(text.length, offset + chunkSize);
    if (end < text.length) {
      const newline = text.lastIndexOf("\n", end);
      if (newline > offset + Math.floor(chunkSize / 2)) end = newline;
    }
    chunks.push(text.slice(offset, end));
    offset = end;
  }
  return chunks;
}

export function grepText(text: string, pattern: string, limit: number): string[] {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "i");
  } catch {
    regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }
  const lines = text.split(/\r?\n/);
  const matches: string[] = [];
  for (let i = 0; i < lines.length && matches.length < limit; i++) {
    if (regex.test(lines[i])) matches.push(`${i + 1}: ${lines[i]}`);
  }
  return matches;
}
