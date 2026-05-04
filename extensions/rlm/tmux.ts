import { spawn } from "node:child_process";

function runTmux(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("tmux", args, { stdio: "ignore" });
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`tmux ${args.join(" ")} failed with code ${code}`))));
  });
}

export async function startTmuxVisualizer(runId: string, eventsPath: string, treePath: string, outputPath: string): Promise<string | undefined> {
  const session = `pi-rlm-${runId}`;
  try {
    await runTmux(["new-session", "-d", "-s", session, "-n", "events", "bash", "-lc", `touch ${shellQuote(eventsPath)} && tail -F ${shellQuote(eventsPath)}`]);
    await runTmux(["new-window", "-t", session, "-n", "tree", "bash", "-lc", `while true; do clear; test -f ${shellQuote(treePath)} && cat ${shellQuote(treePath)} || echo waiting for tree.json; sleep 1; done`]);
    await runTmux(["new-window", "-t", session, "-n", "output", "bash", "-lc", `while true; do clear; test -f ${shellQuote(outputPath)} && cat ${shellQuote(outputPath)} || echo waiting for output.md; sleep 1; done`]);
    return session;
  } catch {
    return undefined;
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
