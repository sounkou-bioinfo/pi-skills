import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getCapabilities, setCapabilities } from "@earendil-works/pi-tui";

export default function vscodePathLinksExtension(pi: ExtensionAPI): void {
	if (process.env.TERM_PROGRAM !== "vscode") return;

	const previous = getCapabilities().hyperlinks;
	setCapabilities({ ...getCapabilities(), hyperlinks: false });

	pi.on("session_shutdown", () => {
		setCapabilities({ ...getCapabilities(), hyperlinks: previous });
	});
}
