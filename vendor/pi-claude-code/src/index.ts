import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  absoluteConfigDir,
  accountEnv,
  accountsPath,
  addAccount,
  DEFAULT_ACCOUNT,
  nextAccount,
  readAccounts,
  removeAccount,
  selectAccount,
  updateAccounts,
  type ClaudeAccounts,
} from "./accounts.ts";
import { getClaudeStatus } from "./claude-cli.ts";
import { claudeCodeEnv, createClaudeCodeProvider } from "./provider.ts";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

const USAGE = "Usage: /claude-account [list | next | <name> | add <name> <config-dir> | remove <name>]";

function describe(state: ClaudeAccounts): string {
  return [DEFAULT_ACCOUNT, ...Object.keys(state.accounts)]
    .map((name) => {
      const marker = (state.active ?? DEFAULT_ACCOUNT) === name ? "*" : " ";
      const dir = name === DEFAULT_ACCOUNT ? "configured Claude Code login" : state.accounts[name];
      return `${marker} ${name}  ${dir}`;
    })
    .join("\n");
}

export default function claudeCodeExtension(pi: ExtensionAPI): void {
  const file = accountsPath(getAgentDir());
  const accounts = () => readAccounts(file);
  const statusEnv = async () => ({ ...claudeCodeEnv(), ...accountEnv(await accounts()) });
  pi.registerProvider(createClaudeCodeProvider({ accounts }));

  pi.registerCommand("claude-code-status", {
    description: "Check the Claude Code executable and subscription login",
    handler: async (_args, ctx) => {
      const status = await getClaudeStatus(await statusEnv(), ctx.signal);
      if (!status.available || !status.loggedIn) {
        ctx.ui.notify(status.detail ?? "Claude Code is not ready", "error");
        return;
      }
      const plan = status.plan ? ` (${status.plan})` : "";
      ctx.ui.notify(`Claude Code is installed and logged in${plan}`, "info");
    },
  });

  pi.registerCommand("claude-account", {
    description: "List, add, or switch Claude Code subscription accounts",
    getArgumentCompletions: async (prefix) => {
      const state = await accounts().catch((): ClaudeAccounts => ({ accounts: {} }));
      const items = ["list", "next", "add", "remove", DEFAULT_ACCOUNT, ...Object.keys(state.accounts)]
        .filter((value) => value.startsWith(prefix))
        .map((value) => ({ value, label: value }));
      return items.length ? items : null;
    },
    handler: async (args, ctx) => {
      const [verb = "list", ...rest] = args.trim().split(/\s+/u).filter(Boolean);
      let state: ClaudeAccounts;
      try {
        if (verb === "list") {
          if (rest.length) throw new Error(USAGE);
          ctx.ui.notify(describe(await accounts()), "info");
          return;
        }
        if (verb === "add") {
          const [name, dir] = rest;
          if (!name || !dir || rest.length > 2) throw new Error(USAGE);
          const absolute = absoluteConfigDir(dir, ctx.cwd);
          await updateAccounts(file, (state) => addAccount(state, name, absolute));
          ctx.ui.notify(
            `Added Claude account "${name}" at ${absolute}. Log in once with: CLAUDE_CONFIG_DIR=${absolute} claude auth login`,
            "info",
          );
          return;
        }
        let change: (state: ClaudeAccounts) => ClaudeAccounts;
        if (verb === "remove") {
          const [name] = rest;
          if (!name || rest.length > 1) throw new Error(USAGE);
          change = (state) => removeAccount(state, name);
        } else if (verb === "next") {
          if (rest.length) throw new Error(USAGE);
          change = (state) => {
            const name = nextAccount(state);
            if (!name) throw new Error("No other Claude account is configured. Add one with /claude-account add <name> <config-dir>");
            return selectAccount(state, name);
          };
        } else {
          if (rest.length) throw new Error(USAGE);
          change = (state) => selectAccount(state, verb);
        }
        state = await updateAccounts(file, change);
      } catch (error) {
        ctx.ui.notify(message(error), "error");
        return;
      }
      const active = state.active ?? DEFAULT_ACCOUNT;
      const status = await getClaudeStatus({ ...claudeCodeEnv(), ...accountEnv(state) }, ctx.signal).catch(
        (error: unknown) => ({ available: false, loggedIn: false, detail: message(error), plan: undefined }),
      );
      if (!status.available || !status.loggedIn) {
        ctx.ui.notify(`Claude account "${active}" is selected but not ready: ${status.detail ?? "not logged in"}`, "warning");
        return;
      }
      const plan = status.plan ? ` (${status.plan})` : "";
      ctx.ui.notify(`Claude requests now use account "${active}"${plan}`, "info");
    },
  });
}

export { createClaudeCodeProvider } from "./provider.ts";
export { streamClaudeCode } from "./stream.ts";
