import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { stripVTControlCharacters } from "node:util";
import type { WorkbenchContract } from "./workbench.js";

export const PLAN_LABELS = {
  acceptance: "What you'll get",
  invariants: "What stays unchanged",
  autonomy: "I can do on my own",
  escalation: "I'll come back to you when",
} as const;
export type CardAction = "start" | "change" | "more" | "cancel";
export type CardModel = {
  objective: string;
  contract?: WorkbenchContract;
  allowance: number;
  question?: string;
  reason?: string;
  report?: string;
};

export function terminalText(text: string): string {
  return stripVTControlCharacters(text).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
}

export function planText(model: CardModel): string {
  return [
    model.objective,
    ...(model.question ? [`${model.question}\nWhy: ${model.reason ?? ""}`] : []),
    ...(model.report ? [`Agent report — inspect its evidence\n${model.report}`] : []),
    ...(model.contract ? Object.entries(PLAN_LABELS).map(([key, label]) => `${label}\n${model.contract![key as keyof WorkbenchContract] || "Not specified — choose Change plan"}`) : []),
    model.contract ? `Work limit: ${model.allowance} tool calls. This is not a spending cap.` : "Resumes the existing goal; grants no new workbench allowance.",
    "You can pause work at any time. Already started operations may finish.",
  ].map(terminalText).join("\n\n");
}

/** A scrollable plan with pinned, keyboard-operable decisions. */
export class WorkbenchCard {
  private offset = 0;
  private page = 1;
  private selected = 0;
  private seenEnd = false;
  private canReview = false;
  private notice = "";
  private closed = false;
  private readonly actions: CardAction[] = ["start", "change", "more", "cancel"];

  constructor(
    private model: CardModel,
    private height: () => number,
    private done: (action: CardAction) => void,
    private theme?: () => Pick<ExtensionContext["ui"]["theme"], "fg" | "bold">,
  ) {}
  invalidate() {}

  private choose(action: CardAction) {
    if (this.closed) return;
    if (action === "start") {
      if (!this.canReview || !this.seenEnd) { this.notice = "Scroll through the plan before starting."; return; }
      if (Object.values(this.model.contract ?? {}).some((value) => !value.trim())) { this.notice = "Complete the plan with Change plan."; return; }
    }
    this.closed = true;
    this.done(action);
  }

  handleInput(data: string) {
    this.notice = "";
    if (matchesKey(data, "escape") || data === "x" || data === "q") this.choose("cancel");
    else if (data === "a") this.choose("start");
    else if (data === "e") this.choose("change");
    else if (data === "m") this.choose("more");
    else if (matchesKey(data, "enter")) this.choose(this.actions[this.selected]);
    else if (matchesKey(data, "tab") || matchesKey(data, "right")) this.selected = (this.selected + 1) % this.actions.length;
    else if (matchesKey(data, "shift+tab") || matchesKey(data, "left")) this.selected = (this.selected + this.actions.length - 1) % this.actions.length;
    else if (matchesKey(data, "down")) this.offset++;
    else if (matchesKey(data, "up")) this.offset = Math.max(0, this.offset - 1);
    else if (matchesKey(data, "pageDown") || data === " ") this.offset += this.page;
    else if (matchesKey(data, "pageUp")) this.offset = Math.max(0, this.offset - this.page);
  }

  render(width: number): string[] {
    width = Math.max(1, width);
    const height = Math.max(1, this.height());
    const theme = this.theme?.();
    this.canReview = width >= 20 && height >= 8;
    if (!this.canReview) return ["Review work", "Enlarge terminal to review", "Esc: cancel"].slice(0, height).map((line) => truncateToWidth(line, width));
    const labels = [this.model.question ? "[a] Reply & start" : "[a] Approve & start", "[e] Change plan", "[m] More…", "[x] Cancel"];
    const buttons = labels.map((label, index) => {
      const text = `${index === this.selected ? "›" : " "} ${label}`;
      return index === this.selected && theme ? theme.fg("accent", theme.bold(text)) : text;
    });
    this.page = Math.max(1, height - buttons.length - 3);
    const body = wrapTextWithAnsi(planText(this.model), width);
    this.offset = Math.min(this.offset, Math.max(0, body.length - this.page));
    if (this.offset + this.page >= body.length) this.seenEnd = true;
    const title = this.model.question ? "Needs your input — work paused" : "Review work";
    const progress = this.notice || (this.offset + this.page < body.length ? "More plan below · Space / ↓" : "Plan shown · choose an action");
    const page = body.slice(this.offset, this.offset + this.page);
    return [
      theme ? theme.fg("accent", theme.bold(title)) : title,
      ...page, ...Array(this.page - page.length).fill(""),
      progress, ...buttons, "↑↓/Space scroll · Tab/Enter choose",
    ].map((line) => truncateToWidth(line, width));
  }
}
