"""Render docs/pages/*.md into docs/index.html (a static three-column SDK reference) and docs/llms.txt.

Run: python docs/build_site.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

DOCS = Path(__file__).resolve().parent
PAGES = DOCS / "pages"
REPO = "https://github.com/felofix/signal-sdk"
VERSION = re.search(r'^version = "([^"]+)"', (DOCS.parent / "pyproject.toml").read_text(), re.M).group(1)

NAV = [
    ("Get started", ["introduction", "installation", "quickstart", "experiments"]),
    ("Guides", ["concepts", "trajectories", "domains", "rulers", "comparisons", "certificates", "statistics", "limitations"]),
    ("SDK reference", ["ref-measure", "ref-run-experiment", "ref-rate-trials", "ref-dataset-distribution", "ref-function",
                       "ref-function-implementation", "ref-domain", "ref-trace-recorder", "ref-rulers", "ref-certificates",
                       "ref-visualization", "ref-statistics", "ref-payments", "ref-cli"]),
    ("Types", ["type-trajectory", "type-measurement", "type-grades", "type-environment"]),
]


def parse(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    match = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not match:
        raise SystemExit(f"{path.name}: missing front matter")
    meta = dict(line.split(":", 1) for line in match.group(1).splitlines() if ":" in line)
    meta = {k.strip(): v.strip() for k, v in meta.items()}
    slug = meta.get("slug") or re.sub(r"^(ref|type)-", "", path.stem)
    return {"slug": slug, "file": path.stem, "title": meta["title"], "group": meta.get("group", ""),
            "summary": meta.get("summary", ""), "markdown": text[match.end():].strip()}


def load() -> list[dict]:
    by_file = {p.stem: parse(p) for p in PAGES.glob("*.md")}
    ordered = []
    for group, files in NAV:
        for name in files:
            page = by_file.pop(name)
            page["group"] = group
            ordered.append(page)
    if by_file:
        raise SystemExit(f"Pages not in NAV: {sorted(by_file)}")
    slugs = [p["slug"] for p in ordered]
    if len(set(slugs)) != len(slugs):
        raise SystemExit(f"Duplicate slugs: {sorted(s for s in slugs if slugs.count(s) > 1)}")
    return ordered


MARK = (DOCS / "assets" / "logo.svg").read_text().replace('color="#000"', 'aria-hidden="true"').split("\n", 0)[0]
MARK = re.sub(r"<!--.*?-->", "", MARK).strip()

SHELL = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Signal SDK docs</title>
<meta name="description" content="Signal SDK documentation: measure agent systems with deterministic graders, rulers and paired statistics.">
<link rel="icon" href="assets/logo.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Newsreader:opsz,wght@6..72,400&display=swap" rel="stylesheet">
<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<style>
:root {
  --bg: #ffffff; --bg-2: #f7f7f5; --ink: #141413; --ink-2: #4d4d49; --ink-3: #82827c; --line: #e8e8e4;
  --accent: #1f5e4a; --accent-soft: #e7f1ed; --code-bg: #f7f7f5;
  --hl-kw: #7a3e9d; --hl-str: #1f5e4a; --hl-num: #9a5b0e; --hl-com: #82827c; --hl-fn: #1a4fa3; --hl-cls: #8a4b12;
  --sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  --serif: "Newsreader", Georgia, serif;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0f0f0e; --bg-2: #161615; --ink: #ecece6; --ink-2: #b4b4ad; --ink-3: #7c7c76; --line: #262623;
    --accent: #7fc4a8; --accent-soft: #14251f; --code-bg: #161615;
    --hl-kw: #c99ae6; --hl-str: #8fd0b5; --hl-num: #e0b060; --hl-com: #7c7c76; --hl-fn: #8ab4f8; --hl-cls: #e0a070;
  }
}
:root[data-theme="dark"] {
  --bg: #0f0f0e; --bg-2: #161615; --ink: #ecece6; --ink-2: #b4b4ad; --ink-3: #7c7c76; --line: #262623;
  --accent: #7fc4a8; --accent-soft: #14251f; --code-bg: #161615;
  --hl-kw: #c99ae6; --hl-str: #8fd0b5; --hl-num: #e0b060; --hl-com: #7c7c76; --hl-fn: #8ab4f8; --hl-cls: #e0a070;
}
* { box-sizing: border-box; margin: 0; }
html { scroll-behavior: smooth; }
body { background: var(--bg); color: var(--ink); font-family: var(--sans); font-size: 15px; line-height: 1.6; -webkit-font-smoothing: antialiased; }
a { color: var(--accent); text-decoration: none; } a:hover { text-decoration: underline; text-underline-offset: 3px; }
code, pre, kbd { font-family: var(--mono); font-size: 13px; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }

.top { position: sticky; top: 0; z-index: 20; background: var(--bg); border-bottom: 1px solid var(--line); height: 56px; }
.top-inner { max-width: 1440px; margin: 0 auto; height: 100%; display: flex; align-items: center; gap: 1.25rem; padding-inline: 20px; }
.brand { display: inline-flex; align-items: center; gap: .5rem; color: var(--ink); font-family: var(--serif); font-size: 1.25rem; letter-spacing: -.02em; }
.brand:hover { text-decoration: none; opacity: .75; }
.brand svg { height: 20px; width: auto; } .brand small { font-family: var(--sans); font-size: .8rem; color: var(--ink-3); }
.search { flex: 1; max-width: 420px; position: relative; }
.search input { width: 100%; height: 34px; padding: 0 64px 0 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg-2); color: var(--ink); font: inherit; font-size: 14px; }
.search kbd { position: absolute; right: 8px; top: 7px; font-size: 11px; color: var(--ink-3); border: 1px solid var(--line); border-radius: 4px; padding: 1px 6px; background: var(--bg); }
.results { position: absolute; top: 40px; left: 0; right: 0; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; box-shadow: 0 8px 24px rgba(0,0,0,.08); max-height: 60vh; overflow: auto; padding: 4px; }
.results a { display: block; padding: 8px 10px; border-radius: 4px; color: var(--ink); }
.results a:hover, .results a.active { background: var(--bg-2); text-decoration: none; }
.results .g { font-size: 11px; color: var(--ink-3); text-transform: uppercase; letter-spacing: .08em; margin-right: .5rem; }
.results .s { display: block; font-size: 13px; color: var(--ink-2); }
.top-right { margin-left: auto; display: flex; align-items: center; gap: .75rem; font-size: 13px; }
.pill { border: 1px solid var(--line); border-radius: 6px; padding: 4px 10px; color: var(--ink-2); background: var(--bg); }
.top-right a.pill { color: var(--ink); } .top-right a.pill:hover { text-decoration: none; background: var(--bg-2); }
.menu { display: none; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--ink); padding: 4px 10px; font: inherit; font-size: 13px; }

.layout { max-width: 1440px; margin: 0 auto; display: grid; grid-template-columns: 260px minmax(0, 1fr) 440px; gap: 0 48px; padding-inline: 20px; }
.side { position: sticky; top: 56px; height: calc(100vh - 56px); overflow-y: auto; padding-block: 28px 40px; padding-right: 8px; border-right: 1px solid var(--line); }
.side h6 { font-size: 11px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-3); margin: 22px 0 8px; }
.side h6:first-child { margin-top: 0; }
.side a { display: block; padding: 5px 10px; margin-left: -10px; border-radius: 6px; color: var(--ink-2); font-size: 14px; }
.side a:hover { color: var(--ink); background: var(--bg-2); text-decoration: none; }
.side a.active { color: var(--accent); background: var(--accent-soft); font-weight: 500; }
.side a code { font-size: 13px; color: inherit; background: none; padding: 0; }

.content { padding-block: 36px 80px; min-width: 0; max-width: 720px; }
.crumb { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3); font-weight: 600; }
.page-head { display: flex; justify-content: space-between; align-items: start; gap: 1rem; margin: 6px 0 4px; }
.content h1 { font-size: 32px; line-height: 1.2; letter-spacing: -.02em; font-weight: 600; text-wrap: balance; }
.content h1 code { font-size: 26px; background: none; padding: 0; }
.summary { color: var(--ink-2); font-size: 16px; margin-bottom: 24px; }
.copy-md { flex: none; border: 1px solid var(--line); background: var(--bg); color: var(--ink-2); border-radius: 6px; padding: 5px 10px; font: inherit; font-size: 12px; cursor: pointer; margin-top: 8px; }
.copy-md:hover { background: var(--bg-2); color: var(--ink); }
.md h2 { font-size: 20px; font-weight: 600; letter-spacing: -.01em; margin: 40px 0 10px; padding-top: 16px; border-top: 1px solid var(--line); }
.md h3 { font-size: 16px; font-weight: 600; margin: 24px 0 6px; }
.md p, .md li { color: var(--ink); } .md p { margin: 0 0 14px; max-width: 68ch; }
.md ul, .md ol { padding-left: 1.3rem; margin: 0 0 14px; } .md li { margin: 4px 0; }
.md code { background: var(--code-bg); border: 1px solid var(--line); border-radius: 4px; padding: .1em .35em; font-size: 13px; }
.md pre { background: var(--code-bg); border: 1px solid var(--line); border-radius: 6px; padding: 14px 16px; overflow-x: auto; margin: 0 0 16px; line-height: 1.55; }
.md pre code { background: none; border: 0; padding: 0; font-size: 13px; }
.md table { width: 100%; border-collapse: collapse; font-size: 14px; margin: 0 0 16px; }
.md th, .md td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
.md th { font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-3); font-weight: 600; }
.md td:first-child code { color: var(--ink); }
.md td:nth-child(3):not(:last-child) { color: var(--ink-3); font-size: 13px; white-space: nowrap; }
.md .table-scroll { overflow-x: auto; margin: 0 0 16px; }
.md strong { font-weight: 600; }
.md blockquote { border-left: 2px solid var(--accent); padding-left: 12px; color: var(--ink-2); margin: 0 0 14px; }
.pager { display: flex; justify-content: space-between; gap: 1rem; margin-top: 56px; padding-top: 20px; border-top: 1px solid var(--line); font-size: 14px; }
.pager span { display: block; font-size: 12px; color: var(--ink-3); }

.rail { position: sticky; top: 56px; height: calc(100vh - 56px); overflow-y: auto; padding-block: 36px 40px; min-width: 0; }
.rail-block { border: 1px solid var(--line); border-radius: 6px; background: var(--code-bg); margin-bottom: 14px; overflow: hidden; }
.rail-head { display: flex; justify-content: space-between; align-items: center; padding: 6px 12px; border-bottom: 1px solid var(--line); font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3); }
.rail-head button { border: 0; background: none; color: var(--ink-3); font: inherit; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; cursor: pointer; }
.rail-head button:hover { color: var(--ink); }
.rail pre { margin: 0; padding: 14px 16px; overflow-x: auto; background: none; border: 0; line-height: 1.55; }
.rail pre code { font-size: 13px; }
.rail-empty { color: var(--ink-3); font-size: 13px; }
.md .in-rail { display: none; }

.hljs-keyword, .hljs-built_in, .hljs-literal { color: var(--hl-kw); } .hljs-string { color: var(--hl-str); }
.hljs-number { color: var(--hl-num); } .hljs-comment { color: var(--hl-com); font-style: italic; }
.hljs-title, .hljs-title.function_ { color: var(--hl-fn); } .hljs-title.class_, .hljs-type { color: var(--hl-cls); }
.hljs-params, .hljs-punctuation { color: inherit; } .hljs-attr, .hljs-meta { color: var(--hl-cls); }

@media (max-width: 1199px) {
  .layout { grid-template-columns: 240px minmax(0, 1fr); }
  .rail { display: none; } .md .in-rail { display: block; }
  .content { max-width: none; }
}
@media (max-width: 799px) {
  .layout { grid-template-columns: 1fr; gap: 0; }
  .side { display: none; position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--line); padding-block: 16px; }
  .side.open { display: block; }
  .menu { display: inline-block; } .search { display: none; } .pill.version { display: none; }
  .content h1 { font-size: 26px; }
}
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
</style>
</head>
<body>
<header class="top"><div class="top-inner">
  <a class="brand" href="#/introduction" aria-label="Signal SDK docs">__MARK__<span>signal</span><small>docs</small></a>
  <div class="search"><input id="q" type="search" placeholder="Search the docs" aria-label="Search the docs" autocomplete="off"><kbd>⌘K</kbd><div id="results" class="results" hidden></div></div>
  <div class="top-right">
    <button class="menu" id="menu" aria-expanded="false" aria-controls="side">Menu</button>
    <span class="pill">Python</span>
    <span class="pill version">v__VERSION__</span>
    <a class="pill" href="example.html">Example</a>
    <a class="pill" href="__REPO__">GitHub</a>
  </div>
</div></header>
<div class="layout">
  <nav class="side" id="side" aria-label="Documentation"></nav>
  <main class="content" id="content"></main>
  <aside class="rail" id="rail" aria-label="Examples"></aside>
</div>
<script id="pages" type="application/json">__PAGES__</script>
<script>
const pages = JSON.parse(document.getElementById('pages').textContent);
const bySlug = Object.fromEntries(pages.map(p => [p.slug, p]));
const groups = [...new Set(pages.map(p => p.group))];
marked.setOptions({ gfm: true, breaks: false });
const renderer = new marked.Renderer();
renderer.code = (code, infostring) => {
  const lang = (infostring || '').trim().split(/\\s+/)[0];
  const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
  const html = hljs.highlight(code, { language }).value;
  return `<pre data-lang="${language}"><code class="hljs language-${language}">${html}</code></pre>`;
};
renderer.table = (header, body) => `<div class="table-scroll"><table><thead>${header}</thead><tbody>${body}</tbody></table></div>`;
marked.use({ renderer });

function nav(active) {
  const side = document.getElementById('side');
  side.innerHTML = groups.map(g => `<h6>${g}</h6>` + pages.filter(p => p.group === g).map(p =>
    `<a href="#/${p.slug}" class="${p.slug === active ? 'active' : ''}">${p.title.includes('()') || /^[A-Z]/.test(p.title) && p.group !== 'Guides' && p.group !== 'Get started' ? '<code>' + p.title + '</code>' : p.title}</a>`).join('')).join('');
}

function render(slug) {
  const page = bySlug[slug] || bySlug.introduction;
  nav(page.slug);
  const index = pages.indexOf(page);
  const prev = pages[index - 1], next = pages[index + 1];
  const content = document.getElementById('content');
  content.innerHTML = `<div class="crumb">${page.group}</div>
    <div class="page-head"><h1>${/\\(\\)$|^[A-Z][A-Za-z]+$/.test(page.title) && page.group !== 'Guides' && page.group !== 'Get started' ? '<code>' + page.title + '</code>' : page.title}</h1>
    <button class="copy-md" id="copy-md" title="Copy this page as Markdown">Copy as Markdown</button></div>
    <p class="summary">${page.summary}</p><div class="md" id="md"></div>
    <nav class="pager">${prev ? `<a href="#/${prev.slug}"><span>Previous</span>${prev.title}</a>` : '<span></span>'}${next ? `<a href="#/${next.slug}" style="text-align:right"><span>Next</span>${next.title}</a>` : ''}</nav>`;
  const md = document.getElementById('md');
  md.innerHTML = marked.parse(page.markdown);
  document.getElementById('copy-md').onclick = async (e) => {
    const text = `# ${page.title}\\n\\n${page.summary}\\n\\n${page.markdown}`;
    try { await navigator.clipboard.writeText(text); e.target.textContent = 'Copied'; setTimeout(() => e.target.textContent = 'Copy as Markdown', 1500); }
    catch { e.target.textContent = 'Select and copy'; }
  };
  const rail = document.getElementById('rail');
  rail.innerHTML = '';
  const example = [...md.querySelectorAll('h2')].find(h => h.textContent.trim() === 'Example');
  const blocks = [];
  if (example) {
    let node = example.nextElementSibling;
    while (node && node.tagName !== 'H2') { if (node.tagName === 'PRE') blocks.push(node); node = node.nextElementSibling; }
  }
  if (!blocks.length) { rail.innerHTML = '<p class="rail-empty">No example on this page.</p>'; }
  if (example) {
    let node = example.nextElementSibling, onlyCode = true;
    while (node && node.tagName !== 'H2') { if (node.tagName !== 'PRE') onlyCode = false; node = node.nextElementSibling; }
    if (onlyCode && blocks.length) example.classList.add('in-rail');
  }
  blocks.forEach(pre => {
    pre.classList.add('in-rail');
    const block = document.createElement('div'); block.className = 'rail-block';
    const head = document.createElement('div'); head.className = 'rail-head';
    head.innerHTML = `<span>${pre.dataset.lang || 'code'}</span><button type="button">Copy</button>`;
    head.querySelector('button').onclick = async (e) => { try { await navigator.clipboard.writeText(pre.textContent); e.target.textContent = 'Copied'; setTimeout(() => e.target.textContent = 'Copy', 1500); } catch {} };
    const clone = pre.cloneNode(true); clone.classList.remove('in-rail');
    block.append(head, clone); rail.append(block);
  });
  document.title = `${page.title} · Signal SDK docs`;
  document.getElementById('side').classList.remove('open');
  window.scrollTo(0, 0);
}

function route() { render((location.hash || '#/introduction').replace(/^#\\//, '').split('?')[0]); }
window.addEventListener('hashchange', route);
route();

const q = document.getElementById('q'), results = document.getElementById('results');
let cursor = -1;
function search(term) {
  term = term.trim().toLowerCase();
  if (!term) { results.hidden = true; return; }
  const hits = pages.map(p => {
    const hay = (p.title + ' ' + p.summary + ' ' + p.markdown).toLowerCase();
    const score = (p.title.toLowerCase().includes(term) ? 10 : 0) + (p.summary.toLowerCase().includes(term) ? 3 : 0) + (hay.split(term).length - 1);
    return { p, score };
  }).filter(h => h.score > 0).sort((a, b) => b.score - a.score).slice(0, 8);
  results.innerHTML = hits.length ? hits.map(h => `<a href="#/${h.p.slug}"><span class="g">${h.p.group}</span>${h.p.title}<span class="s">${h.p.summary}</span></a>`).join('') : '<a class="s">No results</a>';
  results.hidden = false; cursor = -1;
}
q.addEventListener('input', () => search(q.value));
q.addEventListener('keydown', e => {
  const items = [...results.querySelectorAll('a[href]')];
  if (e.key === 'ArrowDown') { cursor = Math.min(items.length - 1, cursor + 1); items.forEach((a, i) => a.classList.toggle('active', i === cursor)); e.preventDefault(); }
  if (e.key === 'ArrowUp') { cursor = Math.max(0, cursor - 1); items.forEach((a, i) => a.classList.toggle('active', i === cursor)); e.preventDefault(); }
  if (e.key === 'Enter' && items[cursor >= 0 ? cursor : 0]) { location.hash = items[cursor >= 0 ? cursor : 0].getAttribute('href'); results.hidden = true; q.value = ''; q.blur(); }
  if (e.key === 'Escape') { results.hidden = true; q.blur(); }
});
document.addEventListener('click', e => { if (!e.target.closest('.search')) results.hidden = true; if (e.target.closest('.results a')) { results.hidden = true; q.value = ''; } });
document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); q.focus(); q.select(); } });
document.getElementById('menu').onclick = (e) => { const side = document.getElementById('side'); const open = side.classList.toggle('open'); e.target.setAttribute('aria-expanded', String(open)); };
</script>
</body>
</html>
"""


def main() -> int:
    pages = load()
    public = [{k: v for k, v in p.items() if k != "file"} for p in pages]
    payload = json.dumps(public, ensure_ascii=False).replace("</", "<\\/")
    html = (SHELL.replace("__MARK__", MARK).replace("__VERSION__", VERSION).replace("__REPO__", REPO)
            .replace("__PAGES__", payload))
    (DOCS / "index.html").write_text(html, encoding="utf-8")
    llms = [f"# Signal SDK {VERSION}", "", "Documentation for the Signal SDK, a statistical measuring instrument for agent systems.",
            f"Repository: {REPO}", ""]
    for page in pages:
        llms += [f"## {page['title']}", "", f"_{page['group']} · {page['summary']}_", "", page["markdown"], ""]
    (DOCS / "llms.txt").write_text("\n".join(llms), encoding="utf-8")
    print(f"{len(pages)} pages -> docs/index.html ({(DOCS / 'index.html').stat().st_size // 1024} KB), docs/llms.txt")
    return 0


if __name__ == "__main__":
    sys.exit(main())
