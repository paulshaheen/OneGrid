"""Build the OneGrid architecture sheets as light and dark SVG, plus PNG on request.

Standard library only. Each sheet in ./sheets is validated (text fit, overlap,
orthogonal routing, label placement, official icon hashes) before it is written.

    python docs/diagrams/build_diagrams.py              # write SVGs and the gallery
    python docs/diagrams/build_diagrams.py --check      # fail if any output is stale
    python docs/diagrams/build_diagrams.py --png        # also render 2400 px PNGs
    python docs/diagrams/build_diagrams.py --only weather fabric
"""

import argparse
from html import escape
import importlib
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import diagram_engine as engine  # noqa: E402
from sheets import ORDER  # noqa: E402

PNG_WIDTH = 2400
BROWSERS = (
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
)


def load(only=None):
    result = []
    for key in ORDER:
        if only and key not in only:
            continue
        module = importlib.import_module(f"sheets.{key}")
        sheet = module.build()
        sheet.validate()
        result.append((key, module, sheet))
    return result


def gallery(loaded):
    nav, sections = [], []
    for key, module, sheet in loaded:
        name = escape(sheet.name)
        nav.append(f'<li><a href="#{name}">{escape(module.LABEL)}</a></li>')
        sections.append(
            f'<section id="{name}"><h2>{escape(module.LABEL)}</h2><p>{escape(module.SUMMARY)}</p>'
            f'<p><a href="{name}.svg">Light SVG</a> | <a href="{name}.png">Light PNG</a> | '
            f'<a href="{name}-dark.svg">Dark SVG</a> | <a href="{name}-dark.png">Dark PNG</a></p>'
            f'<a href="{name}.svg"><picture><source media="(prefers-color-scheme: dark)" srcset="{name}-dark.svg">'
            f'<img src="{name}.svg" width="{sheet.width}" height="{sheet.canvas_height()}" alt="{escape(sheet.title)}. '
            f'{escape(sheet.subtitle)}"></picture></a><p><a href="#top">Back to sheets</a></p></section>'
        )
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<title>OneGrid architecture sheets</title><style>'
        ':root{color-scheme:light dark;--bg:#F4F6F8;--ink:#14202B;--muted:#4D5D6A;--line:#D3DBE1;--link:#2A63A6}'
        '@media (prefers-color-scheme: dark){:root{--bg:#0B1116;--ink:#E4EBF0;--muted:#A6B4BF;--line:#2B3843;--link:#74AAEE}}'
        'body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 "Segoe UI",system-ui,sans-serif}'
        'main{max-width:1840px;margin:auto;padding:28px 20px}a{color:var(--link)}h1{font-size:34px;margin:0 0 8px}'
        'h2{font-size:24px;margin:0 0 4px}p{color:var(--muted);max-width:80ch}'
        'nav ul{display:flex;flex-wrap:wrap;gap:10px 24px;padding:14px 18px;list-style:none;border:1px solid var(--line);border-radius:10px}'
        'section{margin:48px 0;scroll-margin-top:16px}img{display:block;width:100%;height:auto;border:1px solid var(--line);border-radius:10px}'
        'a:focus-visible{outline:2px solid var(--link);outline-offset:2px}'
        '</style></head><body><main id="top"><h1>OneGrid architecture sheets</h1>'
        '<p>Drawn in the Azure Architecture Center style: official icons with short names, stages and platform '
        'zones, and numbered steps that match the Workflow lists in the articles. The baseline is the logical view; '
        'the other sheets cover Fabric, enterprise networking, DNS, weather execution, identity, monitoring, '
        'regulated controls and recovery. Example network addresses are design allocations, not live inventory.</p>'
        '<p><a href="README.md">Diagram guide</a> | <a href="onegrid-architecture.drawio">Editable draw.io file (all sheets)</a> | '
        '<a href="../architecture/design-guide.md">Design guide</a></p>'
        '<nav aria-label="Architecture sheets"><ul>' + "".join(nav) + '</ul></nav>'
        + "".join(sections) + '</main></body></html>\n'
    ).encode("utf-8")


def find_browser(explicit=None):
    candidates = [explicit] if explicit else [*BROWSERS, shutil.which("msedge"), shutil.which("google-chrome"),
                                             shutil.which("chromium"), shutil.which("chrome")]
    for path in candidates:
        if path and Path(path).is_file():
            return str(path)
    raise SystemExit("--png needs Microsoft Edge or Chrome; pass its path with --browser")


def render_png(browser, svg_path, png_path, sheet, theme):
    height = round(sheet.canvas_height() * PNG_WIDTH / sheet.width)
    background = engine.THEMES[theme]["bg"]
    png_path.unlink(missing_ok=True)  # never mistake an old export for a new one
    # Browser helper processes can hold the profile briefly after exit.
    with tempfile.TemporaryDirectory(prefix="onegrid-png-", ignore_cleanup_errors=True) as tmp:
        page = Path(tmp) / "page.html"
        page.write_text(
            f'<!doctype html><meta charset="utf-8"><style>html,body{{margin:0;background:{background}}}'
            f'img{{display:block;width:{PNG_WIDTH}px;height:{height}px}}</style>'
            f'<img src="{svg_path.resolve().as_uri()}">', encoding="utf-8")
        subprocess.run(
            [browser, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
             "--force-device-scale-factor=1", f"--user-data-dir={Path(tmp) / 'profile'}",
             "--virtual-time-budget=4000", f"--window-size={PNG_WIDTH},{height}",
             f"--screenshot={png_path.resolve()}", page.as_uri()],
            check=True, timeout=180, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        # On Windows the launcher can exit before the browser finishes writing.
        deadline, last = time.monotonic() + 90, -1
        while time.monotonic() < deadline:
            size = png_path.stat().st_size if png_path.is_file() else -1
            if size > 0 and size == last:
                break
            last = size
            time.sleep(1)
    if not png_path.is_file() or png_path.stat().st_size == 0:
        raise SystemExit(f"Browser did not write {png_path.name}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="Compare generated SVGs and gallery instead of writing.")
    parser.add_argument("--png", action="store_true", help="Also render PNGs with a local Edge or Chrome.")
    parser.add_argument("--browser", help="Path to Edge or Chrome for --png.")
    parser.add_argument("--only", nargs="+", choices=ORDER, help="Build only these sheets (skips the gallery).")
    args = parser.parse_args()

    engine.verify_icons()
    loaded = load(args.only)
    generated = {}
    for key, module, sheet in loaded:
        generated[HERE / f"{sheet.name}.svg"] = sheet.render("light").encode("utf-8")
        generated[HERE / f"{sheet.name}-dark.svg"] = sheet.render("dark").encode("utf-8")
    if not args.only:
        generated[HERE / "onegrid-reference-gallery.html"] = gallery(loaded)
        generated[HERE / "onegrid-architecture.drawio"] = engine.drawio_document([s for _, _, s in loaded])

    if args.check:
        stale = [p.name for p, content in generated.items() if not p.is_file() or p.read_bytes() != content]
        if stale:
            raise SystemExit("Stale diagrams:\n" + "\n".join(stale))
        print(f"Verified {len(generated)} files for {len(loaded)} sheets.")
        return

    for path, content in generated.items():
        path.write_bytes(content)
    if args.png:
        browser = find_browser(args.browser)
        for key, module, sheet in loaded:
            for theme, suffix in (("light", ""), ("dark", "-dark")):
                render_png(browser, HERE / f"{sheet.name}{suffix}.svg", HERE / f"{sheet.name}{suffix}.png", sheet, theme)
    print(f"Generated {len(generated)} files for {len(loaded)} sheets" + (" plus PNGs." if args.png else "."))


if __name__ == "__main__":
    main()
