import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Project current invariant policies once; preserve stored history and unowned fields. */
export function registerInvariantSections(pi: ExtensionAPI, sections: Record<string, string>): void {
  const rendered = Object.fromEntries(Object.entries(sections).map(([name, text]) => [name, `<${name}>\n${text}\n</${name}>`]));
  pi.on("before_agent_start", (event) => {
    Object.assign(event.systemPromptOptions.sections, sections);
  });
  pi.on("context_with_system", (event) => {
    const first = event.messages.findIndex((message) => message.role === "system");
    let changed = false;
    const messages = event.messages.map((message, index) => {
      if (message.role !== "system") return message;
      if (index === first) {
        if (Object.entries(rendered).every(([name, text]) => message.sections?.[name] === text)) return message;
        changed = true;
        return { ...message, sections: { ...message.sections, ...rendered } };
      }
      if (!Object.keys(message.sections ?? {}).some((name) => Object.hasOwn(rendered, name))) return message;
      changed = true;
      return { ...message, sections: Object.fromEntries(Object.entries(message.sections ?? {}).filter(([name]) => !Object.hasOwn(rendered, name))) };
    });
    if (first === -1) {
      messages.unshift({ role: "system", content: "", sections: rendered, timestamp: 0 });
      changed = true;
    }
    if (changed) return { messages };
  });
}
