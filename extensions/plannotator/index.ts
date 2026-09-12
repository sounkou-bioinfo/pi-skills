import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import plannotator, { hasPlanBrowserHtml, hasReviewBrowserHtml } from "./upstream.js";
import { configureLocalReview, LOCAL_REVIEW_POLICY } from "./config.js";

export default function localReview(pi: ExtensionAPI): void {
  configureLocalReview(process.env);
  if (!hasPlanBrowserHtml() || !hasReviewBrowserHtml()) throw new Error("Plannotator review assets are missing. Repair the package installation before reviewing work.");
  pi.on("tool_call", (event, ctx) => {
    if (event.toolName === "plannotator_submit_plan" && (!ctx.hasUI || !hasPlanBrowserHtml())) {
      return { block: true, terminate: true, reason: "Plan approval requires interactive Pi and its browser review assets. Review the Markdown plan in an interactive session; no approval was granted." };
    }
  });
  plannotator(pi);
  pi.on("before_agent_start", (event) => ({ systemPrompt: event.systemPrompt + LOCAL_REVIEW_POLICY }));
}
