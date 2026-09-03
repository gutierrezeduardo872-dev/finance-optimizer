#!/usr/bin/env python3
"""
Norte — flatten core/ into src/core.bundle.js for the browser.

SETUP.md refuses a build step, and it is right about why: the old setup
committed only the compiled output, so when the local copy went, the source
went with it. This does not repeat that. core/ is the source, it is committed,
and this script is a deterministic flattener you can re-run at any time to
reproduce the bundle from it. Nothing is generated that cannot be regenerated.

It exists because index.html loads plain scripts sharing one scope and Babel
in the browser cannot resolve ES imports. core/ is real ESM so React Native
can consume it; the browser gets this flattened copy of the same code.

    python3 tools/build-core.py            write src/core.bundle.js
    python3 tools/build-core.py --check    fail if the bundle is out of date

No dependencies. Nothing to install.
"""

import re
import sys
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "core.bundle.js"

# Load order inside the single shared scope. format first: engine reads from it.
SOURCES = ["core/format.js", "core/engine.js", "core/storage.js"]

IMPORT_BLOCK = re.compile(r"^import\s[\s\S]*?from\s+['\"][^'\"]+['\"];?\s*$", re.M)
EXPORT_BLOCK = re.compile(r"^export\s*\{[\s\S]*?\};?\s*$", re.M)
EXPORT_STAR = re.compile(r"^export\s+\*\s+from\s+['\"][^'\"]+['\"];?\s*$", re.M)
EXPORT_DECL = re.compile(r"^export\s+(?=(?:async\s+)?function\s|const\s|let\s|var\s|class\s)", re.M)

TOP_DECL = re.compile(r"^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=", re.M)


def strip_modules(text: str) -> str:
    """Remove ESM syntax, keep every declaration exactly as written."""
    text = IMPORT_BLOCK.sub("", text)
    text = EXPORT_STAR.sub("", text)
    text = EXPORT_BLOCK.sub("", text)
    text = EXPORT_DECL.sub("", text)
    return text


def build() -> str:
    parts, names = [], []
    for rel in SOURCES:
        raw = (ROOT / rel).read_text(encoding="utf-8")
        body = strip_modules(raw)
        for a, b in TOP_DECL.findall(body):
            names.append(a or b)
        parts.append(f"/* ---- {rel} " + "-" * max(0, 60 - len(rel)) + " */\n\n" + body.strip() + "\n")

    dupes = sorted({n for n in names if names.count(n) > 1})
    if dupes:
        sys.exit(f"build-core: name declared twice across core/: {', '.join(dupes)}")

    assigns = "\n".join(f"    globalThis.{n} = {n};" for n in sorted(names))
    header = (
        "/* ===========================================================================\n"
        "   GENERATED — do not edit. Source of truth is core/*.js.\n"
        "   Regenerate with:  python3 tools/build-core.py\n"
        "   ---------------------------------------------------------------------------\n"
        "   core/ is ES modules so React Native can import it. index.html loads plain\n"
        "   scripts in one shared scope, so this file is the same code flattened and\n"
        "   published onto globalThis under the exact names src/*.jsx already call.\n"
        f"   {len(names)} names.\n"
        "   =========================================================================== */\n\n"
        "(function () {\n"
        '  "use strict";\n\n'
    )
    body = "\n".join(parts)
    body = "\n".join(("  " + ln) if ln.strip() else ln for ln in body.split("\n"))
    footer = (
        "\n  /* ---- publish to shared scope "
        + "-" * 31
        + " */\n\n"
        + assigns
        + "\n})();\n"
    )
    return header + body + footer


if __name__ == "__main__":
    out = build()
    if "--check" in sys.argv:
        current = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if current != out:
            sys.exit("build-core: src/core.bundle.js is stale. Run: python3 tools/build-core.py")
        print(f"build-core: src/core.bundle.js is up to date ({len(out.splitlines())} lines)")
    else:
        OUT.write_text(out, encoding="utf-8")
        print(f"build-core: wrote src/core.bundle.js ({len(out.splitlines())} lines)")
