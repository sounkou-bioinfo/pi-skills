#!/usr/bin/env python3
"""Render generated function catalog artifacts from functions.yaml.

The manifest is stored in JSON-formatted YAML so this script can use only the
Python standard library, following the DuckHTS pattern.
"""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path


def die(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(1)


def escape_md(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ")


def load_manifest(path: Path) -> list[dict[str, object]]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        die(f"Failed to parse {path}: {exc}")

    functions = payload.get("functions")
    if not isinstance(functions, list):
        die(f"{path} is missing a top-level 'functions' array")
    return functions


def render_markdown(functions: list[dict[str, object]]) -> str:
    lines = [
        "# Function Catalog",
        "",
        "This file is generated from `functions.yaml`.",
        "",
        "| name | kind | returns | since | deprecated | description |",
        "|---|---|---|---|---|---|",
    ]
    for entry in functions:
        deprecated = entry.get("deprecated") or {}
        deprecated_since = deprecated.get("since", "") if isinstance(deprecated, dict) else ""
        lines.append(
            "| `{name}` | {kind} | `{returns}` | {since} | {deprecated} | {description} |".format(
                name=escape_md(str(entry.get("name", ""))),
                kind=escape_md(str(entry.get("kind", ""))),
                returns=escape_md(str(entry.get("returns", ""))),
                since=escape_md(str(entry.get("since", ""))),
                deprecated=escape_md(str(deprecated_since)),
                description=escape_md(str(entry.get("description", ""))),
            )
        )
    lines.append("")
    return "\n".join(lines)


def write_tsv(path: Path, functions: list[dict[str, object]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
        writer.writerow(["name", "kind", "returns", "since", "deprecated", "description"])
        for entry in functions:
            deprecated = entry.get("deprecated") or {}
            deprecated_since = deprecated.get("since", "") if isinstance(deprecated, dict) else ""
            writer.writerow(
                [
                    entry.get("name", ""),
                    entry.get("kind", ""),
                    entry.get("returns", ""),
                    entry.get("since", ""),
                    deprecated_since,
                    str(entry.get("description", "")).replace("\n", " "),
                ]
            )


def main() -> None:
    if len(sys.argv) != 3:
        die(f"usage: {Path(sys.argv[0]).name} <functions.yaml> <outdir>")

    manifest_path = Path(sys.argv[1]).resolve()
    outdir = Path(sys.argv[2]).resolve()
    outdir.mkdir(parents=True, exist_ok=True)

    functions = load_manifest(manifest_path)
    (outdir / "functions.md").write_text(render_markdown(functions), encoding="utf-8")
    write_tsv(outdir / "functions.tsv", functions)
    print(f"wrote {outdir / 'functions.md'}")
    print(f"wrote {outdir / 'functions.tsv'}")


if __name__ == "__main__":
    main()
