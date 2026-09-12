// Pi's loader evaluates upstream TypeScript; this boundary keeps it out of our tsc build.
export { default } from "@plannotator/pi-extension/index.ts";
export { hasPlanBrowserHtml, hasReviewBrowserHtml } from "@plannotator/pi-extension/plannotator-browser-runtime.ts";
