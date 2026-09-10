/**
 * Render docs/pages/*.md into docs/index.html (a static three-column SDK reference) and docs/llms.txt.
 * Run: node docs/build_site.mjs
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DOCS = dirname(fileURLToPath(import.meta.url));
const PAGES = join(DOCS, "pages");
const REPO = "https://github.com/felofix/signal-sdk";
const VERSION = JSON.parse(readFileSync(join(DOCS, "..", "package.json"), "utf8")).version;

const NAV = [
  ["Get started", ["introduction", "installation", "quickstart", "experiments"]],
  ["Guides", ["concepts", "scenarios", "domains", "rulers", "comparisons", "certificates", "statistics", "limitations"]],
  ["SDK reference", ["ref-measure", "ref-run-experiment", "ref-rate-trials", "ref-dataset-distribution", "ref-function", "ref-function-implementation",
    "ref-domain", "ref-trace-recorder", "ref-rulers", "ref-certificates", "ref-visualization", "ref-statistics", "ref-payments", "ref-cli"]],
  ["Types", ["type-scenario", "type-measurement", "type-grades", "type-environment"]],
];

function parse(path) {
  const text = readFileSync(path, "utf8");
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) throw new Error(`${path}: missing front matter`);
  const meta = Object.fromEntries(match[1].split("\n").filter((l) => l.includes(":")).map((l) => { const i = l.indexOf(":"); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
  const file = path.split("/").pop().replace(/\.md$/, "");
  return { slug: meta.slug || file.replace(/^(ref|type)-/, ""), file, title: meta.title, group: meta.group ?? "", summary: meta.summary ?? "", markdown: text.slice(match[0].length).trim() };
}

function load() {
  const byFile = Object.fromEntries(readdirSync(PAGES).filter((n) => n.endsWith(".md")).map((n) => { const p = parse(join(PAGES, n)); return [p.file, p]; }));
  const ordered = [];
  for (const [group, files] of NAV) for (const name of files) {
    if (!byFile[name]) throw new Error(`Missing page ${name}`);
    ordered.push({ ...byFile[name], group });
    delete byFile[name];
  }
  if (Object.keys(byFile).length) throw new Error(`Pages not in NAV: ${Object.keys(byFile).sort()}`);
  const slugs = ordered.map((p) => p.slug);
  const duplicates = slugs.filter((s, i) => slugs.indexOf(s) !== i);
  if (duplicates.length) throw new Error(`Duplicate slugs: ${duplicates}`);
  return ordered;
}

const MARK = readFileSync(join(DOCS, "assets", "logo.svg"), "utf8").replace('color="#000"', 'aria-hidden="true"').replace(/<!--.*?-->/g, "").trim();
const SHELL = readFileSync(join(DOCS, "site_shell.html"), "utf8");

const pages = load();
const payload = JSON.stringify(pages.map(({ file: _file, ...p }) => p)).replace(/<\//g, "<\\/");
writeFileSync(join(DOCS, "index.html"), SHELL.replace("__MARK__", MARK).replace("__VERSION__", VERSION).replaceAll("__REPO__", REPO).replace("__PAGES__", payload));
const llms = [`# Signal SDK ${VERSION}`, "", "Documentation for the Signal SDK, a statistical measuring instrument for agent systems (TypeScript, Node 20+).", `Repository: ${REPO}`, ""];
for (const page of pages) llms.push(`## ${page.title}`, "", `_${page.group} · ${page.summary}_`, "", page.markdown, "");
writeFileSync(join(DOCS, "llms.txt"), llms.join("\n"));
console.log(`${pages.length} pages -> docs/index.html (${Math.round(statSync(join(DOCS, "index.html")).size / 1024)} KB), docs/llms.txt`);
