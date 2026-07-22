// Framer Server API importer for the Agenta blog.
//
// Pulls the blog content (Blog + Authors collections) straight from the Framer
// project via the official `framer-api` Server API, and writes it into this
// Astro package's content collections + public assets.
//
// SECRETS: the Framer API key is read from `process.env.FRAMER_API_KEY` only.
// This file contains NO secret. Provide the key by sourcing the gitignored env:
//   set -a; source ~/.agenta-marketing.env; set +a
// Optionally export FRAMER_PROJECT_URL if the key alone is not enough to
// resolve the project (see `connect()` below).
//
// Usage:
//   node scripts/import-framer.mjs introspect   # Step 1: list collections + verify (no writes)
//   node scripts/import-framer.mjs import        # Step 2: clean re-import (writes posts/authors/images)
//
// Background: docs/design/marketing-website/research/framer-raw-export.md

import { connect } from "framer-api";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const API_KEY = process.env.FRAMER_API_KEY;
const PROJECT_URL = process.env.FRAMER_PROJECT_URL || ""; // optional

if (!API_KEY) {
  console.error(
    "FRAMER_API_KEY is not set. Run: set -a; source ~/.agenta-marketing.env; set +a",
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------
// `connect(projectUrlOrId, token?)`. We first try the key alone (no project
// URL). If the API refuses, we report exactly what's missing and stop.
async function openFramer() {
  const candidates = [];
  if (PROJECT_URL) {
    candidates.push({
      label: "project-url + key",
      arg0: PROJECT_URL,
      token: API_KEY,
    });
  }
  candidates.push({ label: "key-as-arg0", arg0: API_KEY, token: undefined });
  candidates.push({
    label: "key-as-token-no-project",
    arg0: "",
    token: API_KEY,
  });

  let lastErr;
  for (const c of candidates) {
    try {
      const framer = await connect(c.arg0, c.token);
      console.error(`[connect] succeeded via: ${c.label}`);
      return framer;
    } catch (err) {
      lastErr = err;
      console.error(`[connect] failed via ${c.label}: ${err?.message ?? err}`);
    }
  }
  console.error(
    "\nCould not connect with the key alone. The Server API needs the project " +
      "URL/ID too. Ask the owner for framer.com/projects/<id> and set " +
      "FRAMER_PROJECT_URL.",
  );
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Introspection (Step 1) — no writes
// ---------------------------------------------------------------------------
async function introspect(framer) {
  let info;
  try {
    info = await framer.getProjectInfo();
    console.log("=== PROJECT INFO ===");
    console.log(JSON.stringify(info, null, 2));
  } catch (e) {
    console.error("getProjectInfo failed:", e?.message ?? e);
  }

  const collections = await framer.getCollections();
  console.log(`\n=== COLLECTIONS (${collections.length}) ===`);

  const dump = {};
  for (const col of collections) {
    const fields = await col.getFields();
    const items = await col.getItems();
    const fieldSummary = fields.map((f) => ({
      id: f.id,
      name: f.name,
      type: f.type,
    }));
    console.log(
      `\n--- Collection: "${col.name}" (id=${col.id}) — ${items.length} items ---`,
    );
    console.log("Fields:");
    for (const f of fieldSummary) {
      console.log(`  - ${f.name} (${f.type}) [id=${f.id}]`);
    }
    if (items.length) {
      const sample = items[0];
      console.log("Sample item (first):");
      console.log(JSON.stringify(serializeItem(sample, fields), null, 2));
    }
    dump[col.name] = {
      id: col.id,
      fields: fieldSummary,
      items: items.map((it) => serializeItem(it, fields)),
    };
  }

  // Introspection dump goes in a gitignored repo-relative scratch dir so this
  // step runs on any machine / in CI (not a hardcoded local session path).
  const scratch = path.join(ROOT, ".scratch");
  await mkdir(scratch, { recursive: true });
  await writeFile(
    path.join(scratch, "framer-dump.json"),
    JSON.stringify(dump, null, 2),
  );
  console.log(`\n[dump written to ${scratch}/framer-dump.json]`);
  return dump;
}

// Turn a CollectionItem into a plain object: { id, slug, draft, fields: {name: value} }
function serializeItem(item, fields) {
  const out = { id: item.id, slug: item.slug, draft: item.draft ?? false };
  const fd = item.fieldData ?? {};
  const byId = {};
  for (const f of fields) {
    const entry = fd[f.id];
    byId[f.name] = entry === undefined ? null : extractValue(entry, f);
  }
  out.fields = byId;
  return out;
}

function extractValue(entry, field) {
  if (entry == null) return null;
  const v = entry.value !== undefined ? entry.value : entry;
  return v;
}

// ===========================================================================
// IMPORT (Step 2) — writes posts/authors/images
// ===========================================================================

const POSTS_DIR = path.join(ROOT, "src/content/posts");
const AUTHORS_DIR = path.join(ROOT, "src/content/authors");
const PUBLIC_BLOG = path.join(ROOT, "public/blog");
const PUBLIC_AUTHORS = path.join(ROOT, "public/authors");

// Tag (Framer CMS) → our two-category taxonomy. The live blog filter pills are
// exactly Article / Engineering; the granular CMS Tag is preserved verbatim in
// the post's `tags[]` so no data is dropped. Comparison guides are technical
// "top N" deep-dives → Engineering (matches blog-migration.md rationale).
const CATEGORY_MAP = {
  Engineering: "Engineering",
  Article: "Article",
  Comparison: "Engineering",
  Comparisons: "Engineering",
  "Product Update": "Article",
  "Product Updates": "Article",
  Essay: "Article",
  "Company Updates": "Article",
};

// A Tag value that marks an obvious draft/placeholder (the CMS has a
// "Placerholder" [sic] tag on unfinished items).
const DRAFT_TAGS = new Set(["Placerholder", "Placeholder"]);

// Heuristic: lorem-ipsum description ⇒ unfinished draft.
function looksLikeLorem(text) {
  if (!text) return false;
  return /lorem ipsum/i.test(text);
}

// ---------------------------------------------------------------------------
// Image download. framerusercontent.com URLs → /public/blog/<slug>/ or
// /public/authors/. Returns the site-relative path written (or null on fail).
// ---------------------------------------------------------------------------
async function downloadImage(url, destDir, baseName) {
  if (!url) return null;
  // Strip query (?scale-down-to=...) for the canonical original.
  const cleanUrl = url.split("?")[0];
  let ext = path.extname(new URL(cleanUrl).pathname).toLowerCase();
  if (!ext || ext.length > 5) ext = ".png";
  const fileName = `${baseName}${ext}`;
  const destPath = path.join(destDir, fileName);
  try {
    const res = await fetch(cleanUrl);
    if (!res.ok) {
      console.error(`  [img] ${res.status} for ${cleanUrl}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    await mkdir(destDir, { recursive: true });
    await writeFile(destPath, buf);
    return fileName;
  } catch (e) {
    console.error(`  [img] failed ${cleanUrl}: ${e?.message ?? e}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Link rewriting. Absolute agenta.ai/... links → site-relative; keep
// docs.agenta.ai and any other host absolute.
// ---------------------------------------------------------------------------
function rewriteHref(href) {
  if (!href) return href;
  // Keep the docs subdomain + external untouched.
  if (/^https?:\/\/docs\.agenta\.ai/i.test(href)) return href;
  // `agenta.ai/docs/...` is the docs app path-proxied under the apex (the
  // marketing site does NOT build /docs routes). Keep it ABSOLUTE so it always
  // resolves to the canonical docs URL, matching the Footer's Legal links.
  if (/^https?:\/\/(?:www\.)?agenta\.ai\/docs(\/|$|#|\?)/i.test(href)) {
    return href.replace(
      /^https?:\/\/(?:www\.)?agenta\.ai/i,
      "https://agenta.ai",
    );
  }
  // Match the marketing host (www optional), strip to a site-relative path so
  // /blog, /authors, /pricing, /launch-week-* links stay on-site.
  const m = href.match(/^https?:\/\/(?:www\.)?agenta\.ai(\/[^\s]*)?$/i);
  if (m) {
    let p = m[1] || "/";
    return p;
  }
  return href;
}

// ---------------------------------------------------------------------------
// HTML → MDX converter.
// ---------------------------------------------------------------------------
// Framer formattedText is a flat-ish HTML string. We walk it with a tiny
// hand-rolled tokenizer (no jsdom) into Markdown, keeping fenced code, lists,
// tables (as raw HTML — MDX renders raw HTML), blockquotes, images, links,
// inline code, bold/italic, and YouTube iframes (kept as raw <iframe>).

function decodeEntities(s) {
  if (!s) return s;
  // Decode `&amp;` LAST so we never double-unescape: e.g. `&amp;lt;` must decode
  // to the literal text `&lt;`, not to `<`. Decoding `&amp;`→`&` first would turn
  // it into `&lt;` and the next pass would wrongly decode that to `<`.
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// Escape the few characters that break MDX/Markdown when they appear in plain
// inline text (curly braces start JSX expressions; < starts a tag).
// Escape the MDX-hostile characters in *plain text* only. `<` starts a JSX tag
// and `{`/`}` start/close a JSX expression, so a literal one in prose breaks the
// MDX parser. We escape these exactly once, after all inline markup is built and
// after protected spans (code, links) are pulled out, so we never double-escape.
function escapeMdxText(s) {
  // Escape backslash FIRST (so we don't double-escape the backslashes we add
  // for `{`, `}`, `<`), then the MDX-hostile characters.
  return s.replace(/\\/g, "\\\\").replace(/([{}<])/g, "\\$1");
}

// Convert inline HTML (within a paragraph / heading / list item) to Markdown
// inline syntax. Single pass, no recursion: we protect code spans + link URLs
// behind placeholders, build bold/italic/link markup, escape the remaining
// plain text once, then restore the protected spans verbatim.
function inlineToMd(html) {
  if (!html) return "";
  let out = html;

  // <br> → space (we keep paragraphs whole; hard breaks are rare and noisy).
  out = out.replace(/<br\s*\/?>/gi, " ");

  const protectedSpans = [];
  const protect = (s) => {
    const token = ` P${protectedSpans.length} `;
    protectedSpans.push(s);
    return token;
  };

  // Inline code: <code>...</code> (single-line). Multi-line <code> only ever
  // appears inside <pre>, handled at block level before we reach here. The code
  // text is protected verbatim so MDX-escaping never touches it.
  out = out.replace(/<code>([\s\S]*?)<\/code>/gi, (_m, code) => {
    const c = decodeEntities(code).replace(/`/g, "\\`");
    return protect("`" + c + "`");
  });

  // Bold / italic — strip the inner tags to text, protect nothing (the inner
  // text is escaped with the rest below; the ** / * markers are literal).
  out = out.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, t) => {
    const inner = escapeMdxText(decodeEntities(stripTags(t))).trim();
    return inner ? protect(`**${inner}**`) : "";
  });
  out = out.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, t) => {
    const inner = escapeMdxText(decodeEntities(stripTags(t))).trim();
    return inner ? protect(`*${inner}*`) : "";
  });

  // Links: <a href="...">text</a>. Protect the whole `[text](url)` so the URL
  // (which may contain `_`, `~`, etc.) survives escaping untouched.
  out = out.replace(
    /<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href, text) => {
      let cleanText = stripTags(text).trim();
      const cleanHref = rewriteHref(decodeEntities(href));
      if (!cleanText) return "";
      cleanText = escapeMdxText(decodeEntities(cleanText)).replace(
        /([\[\]])/g,
        "\\$1",
      );
      return protect(`[${cleanText}](${cleanHref})`);
    },
  );

  // Drop any remaining tags but keep their text.
  out = stripTags(out);
  out = decodeEntities(out);
  // Escape MDX-hostile chars in the resulting plain text (code, links, and
  // bold/italic markup are already protected behind placeholders).
  out = escapeMdxText(out);
  // Restore protected spans. Loop because a protected span can nest another
  // (e.g. a link whose text was bold) — one pass leaves the inner token.
  for (let pass = 0; pass < 5 && / P\d+ /.test(out); pass++) {
    out = out.replace(/ P(\d+) /g, (_m, n) => protectedSpans[Number(n)]);
  }
  // Collapse runs of whitespace.
  out = out.replace(/[ \t]+/g, " ").replace(/\s+\n/g, "\n");
  return out.trim();
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, "");
}

// Pull <li>...</li> children from a list body, rendering each to one Markdown
// list line (handles the Framer `<li><p>text</p></li>` wrapper + nested lists).
function renderListItems(listHtml, ordered, depth) {
  const indent = "  ".repeat(depth);
  const lines = [];
  // Match top-level <li> ... </li> (non-greedy; nested lists handled inside).
  const liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  let idx = 1;
  while ((m = liRe.exec(listHtml)) !== null) {
    let body = m[1];
    // Extract a nested list if present.
    let nested = "";
    body = body.replace(
      /<(ul|ol)\b[^>]*>([\s\S]*?)<\/\1>/gi,
      (_x, tag, inner) => {
        nested =
          "\n" + renderListItems(inner, tag.toLowerCase() === "ol", depth + 1);
        return "";
      },
    );
    // Unwrap a leading <p>...</p> wrapper (Framer wraps li text in p).
    const text = inlineToMd(body.replace(/<\/?p\b[^>]*>/gi, " ")).trim();
    const marker = ordered ? `${idx}.` : "-";
    lines.push(`${indent}${marker} ${text}${nested}`);
    idx += 1;
  }
  return lines.join("\n");
}

// The block walker. Splits the top-level HTML into block elements and renders
// each. Inline <img> and block <figure>/<table>/<iframe> are emitted verbatim
// or rewritten. Returns { md, images } where images is a list of
// {url, alt} discovered for download.
function blockToMd(html, ctx) {
  const blocks = [];
  const images = [];
  // Tokenize top-level tags. We scan for a known set of block openers and grab
  // their matching close. Anything else (loose text) is wrapped as a paragraph.
  const blockTags = [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "ul",
    "ol",
    "pre",
    "blockquote",
    "figure",
    "table",
    "iframe",
    "img",
    "hr",
  ];
  let i = 0;
  const len = html.length;

  function matchOpenTag(pos) {
    const m = /^<([a-zA-Z0-9]+)\b([^>]*)>/.exec(html.slice(pos));
    return m;
  }

  while (i < len) {
    // Skip whitespace between blocks.
    if (/\s/.test(html[i])) {
      i++;
      continue;
    }
    if (html[i] !== "<") {
      // Loose text until next tag — wrap as paragraph.
      const next = html.indexOf("<", i);
      const chunk = next === -1 ? html.slice(i) : html.slice(i, next);
      const t = inlineToMd(chunk).trim();
      if (t) blocks.push(t);
      i = next === -1 ? len : next;
      continue;
    }
    const open = matchOpenTag(i);
    if (!open) {
      i++;
      continue;
    }
    const tag = open[1].toLowerCase();
    const attrs = open[2] || "";

    // Self-closing / void: img, hr, br.
    if (tag === "img") {
      const srcM = /src="([^"]*)"/i.exec(attrs);
      const altM = /alt="([^"]*)"/i.exec(attrs);
      if (srcM) {
        const url = decodeEntities(srcM[1]);
        const alt = altM ? decodeEntities(altM[1]) : "";
        images.push({ url, alt });
        blocks.push({ __img: url, alt });
      }
      i += open[0].length;
      continue;
    }
    if (tag === "hr") {
      blocks.push("---");
      i += open[0].length;
      continue;
    }
    if (tag === "br") {
      i += open[0].length;
      continue;
    }

    if (!blockTags.includes(tag)) {
      // Unknown opener — skip just this tag, continue.
      i += open[0].length;
      continue;
    }

    // Find the matching close tag (supports nesting of the same tag).
    const closeRe = new RegExp(`</${tag}>`, "i");
    const openRe = new RegExp(`<${tag}\\b`, "gi");
    let depth = 1;
    let searchPos = i + open[0].length;
    let endPos = -1;
    while (searchPos < len) {
      const nextClose = html.slice(searchPos).search(closeRe);
      if (nextClose === -1) break;
      const absClose = searchPos + nextClose;
      // Count opens of the same tag before this close.
      openRe.lastIndex = searchPos;
      let opensBefore = 0;
      let om;
      while ((om = openRe.exec(html)) !== null) {
        if (om.index >= absClose) break;
        opensBefore++;
      }
      depth += opensBefore;
      depth -= 1;
      if (depth === 0) {
        endPos = absClose;
        break;
      }
      searchPos = absClose + `</${tag}>`.length;
    }
    if (endPos === -1) {
      // Malformed — bail on this tag.
      i += open[0].length;
      continue;
    }
    const innerStart = i + open[0].length;
    const inner = html.slice(innerStart, endPos);
    const blockEnd = endPos + `</${tag}>`.length;

    switch (tag) {
      case "h1":
        blocks.push(`## ${inlineToMd(inner).trim()}`); // demote a stray h1 to h2
        break;
      case "h2":
        blocks.push(`## ${inlineToMd(inner).trim()}`);
        break;
      case "h3":
        blocks.push(`### ${inlineToMd(inner).trim()}`);
        break;
      case "h4":
        blocks.push(`#### ${inlineToMd(inner).trim()}`);
        break;
      case "h5":
        blocks.push(`##### ${inlineToMd(inner).trim()}`);
        break;
      case "h6":
        blocks.push(`###### ${inlineToMd(inner).trim()}`);
        break;
      case "p": {
        const t = inlineToMd(inner).trim();
        if (t) blocks.push(t);
        break;
      }
      case "ul":
        blocks.push(renderListItems(inner, false, 0));
        break;
      case "ol":
        blocks.push(renderListItems(inner, true, 0));
        break;
      case "pre": {
        const langM = /data-language="([^"]*)"/i.exec(attrs);
        const lang = langM ? mapLang(langM[1]) : "";
        // Inner is usually <code>...</code>.
        const codeM = /<code>([\s\S]*?)<\/code>/i.exec(inner);
        const raw = codeM ? codeM[1] : inner;
        const code = decodeEntities(raw).replace(/\s+$/g, "");
        blocks.push("```" + lang + "\n" + code + "\n```");
        break;
      }
      case "blockquote": {
        // Render inner paragraphs to markdown, prefix each line with "> ".
        const sub = blockToMd(inner, ctx);
        for (const im of sub.images) images.push(im);
        const subMd = blocksToString(sub.blocks, {});
        const quoted = subMd
          .split("\n")
          .map((l) => (l.length ? `> ${l}` : ">"))
          .join("\n");
        blocks.push({ __blockquote: quoted, raw: inner });
        break;
      }
      case "figure":
      case "table": {
        // Keep tables as raw HTML — MDX renders it. Normalise the wrapper:
        // strip the <figure> wrapper, keep the <table>. Clean attributes.
        let tableHtml = tag === "figure" ? inner : html.slice(i, blockEnd);
        tableHtml = cleanTableHtml(tableHtml);
        blocks.push({ __raw: tableHtml });
        break;
      }
      case "iframe": {
        // YouTube embeds → keep as a raw <iframe>, entity-decoded src.
        const srcM = /src="([^"]*)"/i.exec(attrs);
        if (srcM) {
          const src = decodeEntities(srcM[1]);
          blocks.push({
            __raw: `<iframe src="${src}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`,
          });
        }
        break;
      }
      default:
        break;
    }
    i = blockEnd;
  }

  return { blocks, images };
}

// Render a blocks array (from blockToMd) to a markdown string. `urlToLocal`
// maps in-body image URLs to their downloaded site-relative path; images with
// no local copy are dropped.
function blocksToString(blocks, urlToLocal) {
  const parts = [];
  for (const b of blocks) {
    if (typeof b === "string") {
      parts.push(b);
    } else if (b.__img) {
      const local = urlToLocal[b.__img];
      if (local) parts.push(`![${escapeAlt(b.alt)}](${local})`);
    } else if (b.__raw) {
      parts.push(b.__raw);
    } else if (b.__blockquote) {
      parts.push(b.__blockquote);
    }
  }
  return parts.join("\n\n");
}

function mapLang(l) {
  const map = {
    JSX: "jsx",
    Python: "python",
    TypeScript: "typescript",
    JavaScript: "javascript",
    Markdown: "markdown",
    Shell: "bash",
    Bash: "bash",
    JSON: "json",
    YAML: "yaml",
  };
  return map[l] ?? l.toLowerCase();
}

// Normalise a Framer table: unwrap the per-cell <p dir="auto"> wrappers so the
// raw HTML is compact, and run inline link/bold rewriting inside cells.
function cleanTableHtml(tableHtml) {
  let t = tableHtml;
  // Drop <tbody> (optional) but keep structure; strip dir attrs.
  t = t.replace(/\sdir="[^"]*"/gi, "");
  t = t.replace(/\sdata-[a-z-]+="[^"]*"/gi, "");
  // Replace cell <p>..</p> with the inline-rendered text, then re-wrap minimal.
  t = t.replace(/<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, cell, inner) => {
    // Inner may have <p>..</p>; join multiple paragraphs with <br/>.
    const paras = [];
    const pRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
    let pm;
    let had = false;
    while ((pm = pRe.exec(inner)) !== null) {
      had = true;
      const txt = inlineHtmlForCell(pm[1]);
      if (txt) paras.push(txt);
    }
    const content = had ? paras.join("<br/>") : inlineHtmlForCell(inner);
    return `<${cell}>${content}</${cell}>`;
  });
  // Whitespace tidy.
  t = t.replace(/>\s+</g, "><").trim();
  return t;
}

// For table cells we keep HTML inline tags (strong/em/a/code) since the cell is
// raw HTML, but rewrite links and decode entities.
function inlineHtmlForCell(html) {
  let out = html;
  out = out.replace(
    /<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href, text) =>
      `<a href="${rewriteHref(decodeEntities(href))}">${stripTags(text).trim()}</a>`,
  );
  // Keep strong/em/code; strip other tags.
  out = out.replace(/<(?!\/?(strong|em|b|i|code|a)\b)[^>]+>/gi, "");
  out = out.replace(/\sdir="[^"]*"/gi, "");
  return out.trim();
}

// ---------------------------------------------------------------------------
// YAML frontmatter helper — quote/escape a scalar string safely.
// ---------------------------------------------------------------------------
function yamlString(s) {
  if (s == null) return '""';
  const str = String(s);
  // Always double-quote and escape backslash + double-quote.
  return `"${str.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// Normalise the Framer "Read" string (e.g. "10 mn", "5mn", "4 Mins Read",
// "10 minutes") to "<n> min read".
function normalizeReadingTime(read) {
  if (!read) return undefined;
  const m = String(read).match(/(\d+)/);
  if (!m) return undefined;
  return `${m[1]} min read`;
}

// ---------------------------------------------------------------------------
// IMPORT main
// ---------------------------------------------------------------------------
async function runImport(framer) {
  const collections = await framer.getCollections();
  const byName = {};
  for (const col of collections) byName[col.name] = col;

  const blogCol = byName["Blog"];
  const authorsCol = byName["Authors"];
  if (!blogCol || !authorsCol) {
    throw new Error(
      `Missing collections. Found: ${Object.keys(byName).join(", ")}`,
    );
  }

  const blogFields = await blogCol.getFields();
  const authorFields = await authorsCol.getFields();
  const blogItems = (await blogCol.getItems()).map((it) =>
    serializeItem(it, blogFields),
  );
  const authorItems = (await authorsCol.getItems()).map((it) =>
    serializeItem(it, authorFields),
  );

  // --- Authors -------------------------------------------------------------
  console.log(`\n=== AUTHORS (${authorItems.length}) ===`);
  // Wipe + recreate dirs.
  await rm(AUTHORS_DIR, { recursive: true, force: true });
  await mkdir(AUTHORS_DIR, { recursive: true });
  // Clean only the author avatars we manage (jpg/png), recreate dir.
  await rm(PUBLIC_AUTHORS, { recursive: true, force: true });
  await mkdir(PUBLIC_AUTHORS, { recursive: true });

  // Map author ref value (slug OR id) → slug, for blog attribution.
  const authorRefToSlug = {};
  for (const a of authorItems) {
    authorRefToSlug[a.slug] = a.slug;
    authorRefToSlug[a.id] = a.slug;
  }

  for (const a of authorItems) {
    const f = a.fields;
    const slug = a.slug;
    const name = f["Title"];
    const role = f["Description"] || "";
    const photo = f["Profile Photo"];
    let avatar = "";
    if (photo && photo.url) {
      const fileName = await downloadImage(photo.url, PUBLIC_AUTHORS, slug);
      if (fileName) avatar = `/authors/${fileName}`;
    }
    const socials = [];
    const ln = f["Linkedin"];
    const gh = f["Github"];
    const tw = f["X / Twitter"];
    if (typeof ln === "string" && ln)
      socials.push({ platform: "linkedin", url: ln });
    if (typeof gh === "string" && gh)
      socials.push({ platform: "github", url: gh });
    if (typeof tw === "string" && tw) socials.push({ platform: "x", url: tw });

    const json = {
      slug,
      name,
      role,
      avatar,
      ...(socials.length ? { socials } : {}),
    };
    await writeFile(
      path.join(AUTHORS_DIR, `${slug}.json`),
      JSON.stringify(json, null, 2) + "\n",
    );
    console.log(
      `  + ${slug} (${name}) avatar=${avatar} socials=${socials.length}`,
    );
  }

  // --- Posts ---------------------------------------------------------------
  console.log(`\n=== POSTS ===`);
  // Wipe posts + their public images.
  await rm(POSTS_DIR, { recursive: true, force: true });
  await mkdir(POSTS_DIR, { recursive: true });
  await rm(PUBLIC_BLOG, { recursive: true, force: true });
  await mkdir(PUBLIC_BLOG, { recursive: true });

  const skipped = [];
  const imported = [];
  const tagCounts = {};
  const authorPrimary = {};
  const authorCo = {};

  for (const item of blogItems) {
    const f = item.fields;
    const slug = item.slug;
    const tag = f["Tag"];
    const description = f["Description"] || "";

    // --- Draft detection ---
    const isDraftFlag = item.draft === true;
    const isDraftTag = tag && DRAFT_TAGS.has(tag);
    const isLorem = looksLikeLorem(description);
    if (isDraftFlag || isDraftTag || isLorem) {
      const reason = isDraftFlag
        ? "draft-flag"
        : isDraftTag
          ? `tag="${tag}"`
          : "lorem-description";
      skipped.push({ slug, reason });
      console.log(`  - SKIP ${slug} (${reason})`);
      continue;
    }

    tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    const category = CATEGORY_MAP[tag] || "Article";

    // --- Authors ---
    const rawRefs = [f["Author"], f["Author 2"], f["Author 3"]];
    const authorSlugs = [];
    for (const r of rawRefs) {
      if (typeof r === "string" && r) {
        const s = authorRefToSlug[r] || r;
        if (!authorSlugs.includes(s)) authorSlugs.push(s);
      }
    }
    const primary = authorSlugs[0];
    const coAuthors = authorSlugs.slice(1);
    if (primary) authorPrimary[primary] = (authorPrimary[primary] || 0) + 1;
    for (const c of coAuthors) authorCo[c] = (authorCo[c] || 0) + 1;

    // --- Date (true ISO) ---
    const dateRaw = f["Date"];
    let dateStr = "";
    if (dateRaw) {
      const dd = new Date(dateRaw);
      dateStr = dd.toISOString().slice(0, 10);
    }

    // --- Hero image ---
    const imgDir = path.join(PUBLIC_BLOG, slug);
    let heroPath = "";
    const heroField = f["Image"];
    if (heroField && heroField.url) {
      const fileName = await downloadImage(heroField.url, imgDir, "hero");
      if (fileName) heroPath = `/blog/${slug}/${fileName}`;
    }

    // --- Content body ---
    const contentHtml = f["Content"] || "";
    const { blocks, images } = blockToMd(contentHtml, { slug });

    // Download in-body images, build a url→localpath map.
    const urlToLocal = {};
    let imgIdx = 1;
    for (const im of images) {
      if (!im.url || !im.url.includes("framerusercontent.com")) continue;
      if (urlToLocal[im.url]) continue;
      const fileName = await downloadImage(im.url, imgDir, `img-${imgIdx}`);
      if (fileName) {
        urlToLocal[im.url] = `/blog/${slug}/${fileName}`;
        imgIdx++;
      }
    }

    // Render blocks → markdown, replacing image placeholders + injecting CTA.
    let ctaInjected = false;
    const mdParts = [];
    let firstH2Seen = false;
    for (const b of blocks) {
      if (typeof b === "string") {
        mdParts.push(b);
        // Inject the single InlineCTA after the first H2.
        if (!ctaInjected && /^## /.test(b)) {
          mdParts.push("<InlineCTA />");
          ctaInjected = true;
        }
      } else if (b.__img) {
        const local = urlToLocal[b.__img];
        if (local) {
          mdParts.push(`![${escapeAlt(b.alt)}](${local})`);
        }
      } else if (b.__raw) {
        mdParts.push(b.__raw);
      } else if (b.__blockquote) {
        mdParts.push(b.__blockquote);
      }
    }
    // If no H2 existed, drop the CTA after the first block.
    if (!ctaInjected && mdParts.length) {
      mdParts.splice(1, 0, "<InlineCTA />");
      ctaInjected = true;
    }

    let body = mdParts
      .join("\n\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    // --- Frontmatter ---
    const fm = [];
    fm.push("---");
    fm.push(`slug: ${yamlString(slug)}`);
    fm.push(`title: ${yamlString(f["Title"])}`);
    fm.push(`description: ${yamlString(description)}`);
    fm.push(`category: ${category}`);
    if (dateStr) fm.push(`date: ${dateStr}`);
    const rt = normalizeReadingTime(f["Read"]);
    if (rt) fm.push(`readingTime: ${yamlString(rt)}`);
    if (heroPath) {
      fm.push(`heroImage: ${heroPath}`);
      fm.push(`ogImage: ${heroPath}`);
    }
    if (primary) fm.push(`author: ${primary}`);
    if (coAuthors.length) fm.push(`coAuthors: [${coAuthors.join(", ")}]`);
    fm.push(`featured: false`);
    // Preserve the original CMS Tag verbatim in tags[] (lower-cased token).
    fm.push(`tags: [${yamlString(tag)}]`);
    fm.push("---");

    const out = fm.join("\n") + "\n\n" + body + "\n";
    await writeFile(path.join(POSTS_DIR, `${slug}.mdx`), out);
    imported.push({ slug, category, tag, date: dateStr, primary, coAuthors });
    console.log(
      `  + ${slug} | ${category} (tag=${tag}) | ${dateStr} | author=${primary}${coAuthors.length ? " + " + coAuthors.join(",") : ""} | imgs=${imgIdx - 1}`,
    );
  }

  // --- Report --------------------------------------------------------------
  console.log("\n================ IMPORT REPORT ================");
  console.log(`Posts imported: ${imported.length}`);
  console.log(`Drafts skipped: ${skipped.length}`);
  for (const s of skipped) console.log(`   - ${s.slug} (${s.reason})`);
  console.log(`\nDistinct CMS tags → category:`);
  for (const [t, n] of Object.entries(tagCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${t} (${n}) → ${CATEGORY_MAP[t] || "Article"}`);
  }
  console.log(`\nPer-author PRIMARY counts:`);
  for (const [a, n] of Object.entries(authorPrimary).sort(
    (x, y) => y[1] - x[1],
  ))
    console.log(`   ${a}: ${n}`);
  console.log(`Per-author CO-AUTHOR counts:`);
  for (const [a, n] of Object.entries(authorCo).sort((x, y) => y[1] - x[1]))
    console.log(`   ${a}: ${n}`);
  console.log("===============================================");

  // Persist a machine report to scratch.
  const scratch =
    "/tmp/claude-1000/-home-mahmoud-code-agenta/26f40a6a-8d2e-490f-9048-49f051a3bb87/scratchpad";
  await writeFile(
    path.join(scratch, "import-report.json"),
    JSON.stringify(
      { imported, skipped, tagCounts, authorPrimary, authorCo },
      null,
      2,
    ),
  );
}

function escapeAlt(s) {
  return (s || "").replace(/[\[\]]/g, "").trim();
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
const cmd = process.argv[2] ?? "introspect";

const framer = await openFramer();
try {
  if (cmd === "introspect") {
    await introspect(framer);
  } else if (cmd === "import") {
    await runImport(framer);
  } else {
    console.error(`Unknown command: ${cmd}. Use "introspect" or "import".`);
    process.exitCode = 1;
  }
} finally {
  await framer.disconnect();
}
