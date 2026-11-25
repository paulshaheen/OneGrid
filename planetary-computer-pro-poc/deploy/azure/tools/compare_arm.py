#!/usr/bin/env python3
"""Fail when the committed azuredeploy.json no longer matches a fresh build of main.bicep.

CI builds main.bicep with the Bicep version recorded in the committed file's
metadata._generator.version, then runs:

    python compare_arm.py --committed azuredeploy.json --built "$RUNNER_TEMP/azuredeploy.json"

Both files are parsed and normalized before comparison:
  * metadata._generator (Bicep name/version/templateHash) is removed, because the hash and
    build number change with every build;
  * CRLF line endings inside strings become LF. main.bicep embeds
    scripts/onegrid-solution-provision.ps1 with loadTextContent(), so a build on a Windows
    checkout (core.autocrlf=true) embeds CRLF while a Linux build embeds LF. The script is the
    same either way.

Everything else, including property order inside arrays, must match. Standard library only.
"""
from __future__ import annotations

import argparse
import difflib
import json
import os
from pathlib import Path
import sys

REBUILD = ("az bicep build --file planetary-computer-pro-poc/deploy/azure/main.bicep "
           "--outfile planetary-computer-pro-poc/deploy/azure/azuredeploy.json")


def normalize(node):
    if isinstance(node, dict):
        return {k: normalize(v) for k, v in node.items()}
    if isinstance(node, list):
        return [normalize(v) for v in node]
    if isinstance(node, str):
        return node.replace("\r\n", "\n")
    return node


def strip_generator(template: dict) -> dict:
    template = json.loads(json.dumps(template))
    metadata = template.get("metadata")
    if isinstance(metadata, dict):
        metadata.pop("_generator", None)
        if not metadata:
            template.pop("metadata")
    return template


def canonical(template: dict) -> dict:
    return normalize(strip_generator(template))


def generator_version(template: dict) -> str:
    return ((template.get("metadata") or {}).get("_generator") or {}).get("version", "unknown")


def diff_lines(committed: dict, built: dict, limit: int = 80):
    a = json.dumps(committed, indent=2, sort_keys=True).splitlines()
    b = json.dumps(built, indent=2, sort_keys=True).splitlines()
    lines = list(difflib.unified_diff(a, b, "azuredeploy.json (committed)", "main.bicep (fresh build)", lineterm="", n=2))
    return lines[:limit], len(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--committed", type=Path, required=True, help="The committed azuredeploy.json.")
    parser.add_argument("--built", type=Path, help="The template CI just built from main.bicep.")
    parser.add_argument("--print-version", action="store_true",
                        help="Print the Bicep version recorded in --committed and exit.")
    args = parser.parse_args(argv)

    committed_raw = json.loads(args.committed.read_text(encoding="utf-8-sig"))
    if args.print_version:
        print(generator_version(committed_raw))
        return 0
    if args.built is None:
        parser.error("--built is required unless --print-version is given")
    built_raw = json.loads(args.built.read_text(encoding="utf-8-sig"))
    committed, built = canonical(committed_raw), canonical(built_raw)
    if committed == built:
        print(f"azuredeploy.json matches main.bicep (committed with Bicep {generator_version(committed_raw)}, "
              f"checked with Bicep {generator_version(built_raw)}).")
        return 0

    lines, total = diff_lines(committed, built)
    print("azuredeploy.json is out of date: it does not match a fresh build of main.bicep.\n")
    print("Rebuild it from the repository root and commit the result:\n")
    print(f"    {REBUILD}\n")
    print("main.bicep embeds scripts/onegrid-solution-provision.ps1 (loadTextContent), so editing that")
    print("script also requires a rebuild. Then update createUiDefinition.json if parameters changed.\n")
    print(f"Normalized difference (first {len(lines)} of {total} diff lines):")
    print("\n".join(lines))
    if os.environ.get("GITHUB_ACTIONS") == "true":
        print(f"::error file={args.committed.as_posix()},title=azuredeploy.json is stale::"
              f"azuredeploy.json does not match main.bicep. Run: {REBUILD}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
