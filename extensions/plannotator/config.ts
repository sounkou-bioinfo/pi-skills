export const LOCAL_REVIEW_POLICY = `

LOCAL REVIEW POLICY
Work locally by default. Use Plannotator for human plan and local diff review; local approval is not permission to publish. Push branches, submit PRs or PR stacks, post remote reviews or comments, trigger remote CI, or merge only when the user explicitly requests that action. Keep exploration in short, read-only Pi tree branches when requested; return with user decisions, evidence, uncertainty, and a proposed next step. Tree navigation changes conversation context, not files or Git state. A branch summary is context to verify, not new user authority.
`;

export function configureLocalReview(env: NodeJS.ProcessEnv): void {
  if (env.PLANNOTATOR_REMOTE && env.PLANNOTATOR_REMOTE !== "0") {
    throw new Error("Local review requires PLANNOTATOR_REMOTE=0, including over SSH. Forward the loopback port through VS Code or SSH instead of exposing an unauthenticated server.");
  }
  if (env.PLANNOTATOR_URL_HOST && !["localhost", "127.0.0.1"].includes(env.PLANNOTATOR_URL_HOST)) {
    throw new Error("Use a loopback PLANNOTATOR_URL_HOST for private local review and SSH forwarding.");
  }
  env.PLANNOTATOR_REMOTE = "0";
  env.PLANNOTATOR_SHARE ??= "disabled";
}
