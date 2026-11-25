#!/usr/bin/env python3
"""Validate ARM parameter files against the compiled OneGrid template.

Checks every *.json parameter file given (default: ../parameters/*.json, plus any compiled
.bicepparam output CI passes in):

  ERROR  unknown parameter name, wrong value type, value outside allowedValues or the
         min/max length or value limits, a required template parameter that is missing,
         or a literal value for a secure parameter (use a Key Vault reference instead;
         secret-bearing parameter files stay outside source control)
  WARN   the file has no deploymentParameters $schema, or sets an "Internal" parameter

Standard library only. Exit code 1 when any ERROR is reported. When there are no parameter
files the check passes with a note, because the folder is optional.

Usage:
  python check_parameter_files.py [--template PATH] [FILE_OR_DIR ...]
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
DEPLOY_DIR = HERE.parent
PYTHON_TYPES = {
    "string": str, "securestring": str, "int": int, "bool": bool,
    "array": list, "object": dict, "secureobject": dict,
}


def type_ok(expected: str, value) -> bool:
    py = PYTHON_TYPES.get(expected.lower())
    if py is None:
        return True
    if py is int:
        return isinstance(value, int) and not isinstance(value, bool)
    return isinstance(value, py)


def check_file(path: Path, template: dict):
    errors, warnings = [], []
    try:
        document = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as exc:
        return [f"cannot parse: {exc}"], []
    schema = str(document.get("$schema", ""))
    if "deploymentParameters" not in schema:
        warnings.append("no deploymentParameters $schema; is this a parameter file?")
    values = document.get("parameters", {})
    if not isinstance(values, dict):
        return ["'parameters' must be an object"], warnings
    tparams = template.get("parameters", {})
    for name, entry in values.items():
        spec = tparams.get(name)
        if spec is None:
            errors.append(f"{name}: not a template parameter")
            continue
        if not isinstance(entry, dict):
            errors.append(f"{name}: expected an object with 'value' or 'reference'")
            continue
        ptype = str(spec.get("type", "")).lower()
        description = (spec.get("metadata") or {}).get("description", "")
        if description.lower().startswith("internal"):
            warnings.append(f"{name}: internal parameter; normally left to its default")
        if "reference" in entry:
            if not ptype.startswith("secure"):
                warnings.append(f"{name}: Key Vault reference used for a non-secure parameter")
            continue
        if "value" not in entry:
            errors.append(f"{name}: missing 'value'")
            continue
        value = entry["value"]
        if ptype.startswith("secure") and value not in ("", None, {}):
            errors.append(f"{name}: literal value for a secure parameter; use a Key Vault reference and keep "
                          "secret-bearing parameter files out of source control")
        if not type_ok(ptype, value):
            errors.append(f"{name}: expected {spec.get('type')}, got {type(value).__name__}")
            continue
        allowed = spec.get("allowedValues")
        if allowed:
            items = value if isinstance(value, list) and ptype == "array" else [value]
            bad = [v for v in items if v not in allowed]
            if bad:
                errors.append(f"{name}: {bad} not in allowedValues {allowed}")
        if isinstance(value, (str, list)):
            if "maxLength" in spec and len(value) > spec["maxLength"]:
                errors.append(f"{name}: longer than maxLength {spec['maxLength']}")
            if "minLength" in spec and len(value) < spec["minLength"]:
                errors.append(f"{name}: shorter than minLength {spec['minLength']}")
        if isinstance(value, int) and not isinstance(value, bool):
            if "maxValue" in spec and value > spec["maxValue"]:
                errors.append(f"{name}: above maxValue {spec['maxValue']}")
            if "minValue" in spec and value < spec["minValue"]:
                errors.append(f"{name}: below minValue {spec['minValue']}")
    for name, spec in tparams.items():
        if name not in values and "defaultValue" not in spec and not spec.get("nullable", False):
            errors.append(f"{name}: required template parameter is missing")
    return errors, warnings


def collect(paths):
    files = []
    for p in paths:
        if p.is_dir():
            files.extend(sorted(x for x in p.glob("*.json")))
        elif p.is_file():
            files.append(p)
    return files


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--template", type=Path, default=DEPLOY_DIR / "azuredeploy.json")
    parser.add_argument("paths", nargs="*", type=Path, default=[DEPLOY_DIR / "parameters"])
    args = parser.parse_args(argv)
    template = json.loads(args.template.read_text(encoding="utf-8-sig"))
    files = collect(args.paths)
    if not files:
        print("No parameter files found; nothing to check.")
        return 0
    github = os.environ.get("GITHUB_ACTIONS") == "true"
    failed = False
    for path in files:
        errors, warnings = check_file(path, template)
        status = "FAIL" if errors else "ok"
        print(f"{status:<4}  {path.as_posix()}")
        for message in errors:
            print(f"      ERROR  {message}")
            if github:
                print(f"::error file={path.as_posix()},title=Parameter file::{message}")
        for message in warnings:
            print(f"      WARN   {message}")
            if github:
                print(f"::warning file={path.as_posix()},title=Parameter file::{message}")
        failed = failed or bool(errors)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
