// Guard for the shared UI primitives. Runs before `astro build` (see package.json).
//
// The marketing site draws its page frame, its section grid, its buttons and its
// eyebrow badges through exactly one place each. Every visual regression we have
// had came from a page re-drawing one of them by hand and drifting. This script
// fails the build when that happens again.
//
//   page frame      .ag-wrap           layouts/Site.astro + styles/global.css
//   section grid    .ag-section        components/Section.astro
//   eyebrow badge   .ag-badge          components/Badge.astro
//   buttons         .ag-btn            components/Button.astro
//
// Add a rule here when you add a primitive. Keep the rules cheap: plain regexes
// over src/**/*.{astro,tsx,css}.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not URL.pathname: on Windows the latter yields "/C:/..." and
// every fs call below would fail before astro build even starts.
const root = fileURLToPath(new URL("../src/", import.meta.url));

const rules = [
  {
    name: "section grid border drawn by hand (use <Section tone=...>)",
    re: /var\(--th-(section|darksec)-border\)/,
    allow: [
      "components/Section.astro",
      "styles/global.css",
      "styles/theme.css",
      // Page-local dividers that are not a band border. Keep this list short.
      "pages/contact.astro",
      "pages/imprint.astro",
    ],
  },
  {
    name: "page frame width drawn by hand (Site.astro owns .ag-wrap)",
    re: /max-width:\s*1440px/,
    allow: ["styles/global.css"],
  },
  {
    name: "old blog chrome override (removed; use <Section tone=\"flat\">)",
    re: /th-page-white|whiteChrome/,
    allow: [],
  },
  {
    name: "eyebrow badge drawn by hand (use <Badge>)",
    re: /var\(--th-badge-(bg|ring|text)\)/,
    allow: ["styles/global.css", "styles/theme.css"],
  },
  {
    name: "eyebrow chip drawn by hand (use <Badge> or class ag-badge)",
    // The inline recipe every drifting eyebrow used: a 22/24px round pill.
    re: /height:2[24]px;padding:0 1[0-3]px;border-radius:999px|height: 2[24],\s*padding: "0 1[0-3]px",\s*borderRadius: (999|"var\(--radius-pill\)")/,
    allow: [
      // Category pills on blog cards and the plan "Most popular" chip are their
      // own components, not section eyebrows.
      "components/PostCard.astro",
      "components/PlanCard.astro",
      // A data chip inside the mocked evaluation chart.
      "components/Reliability.astro",
    ],
  },
  {
    name: "button gradient drawn by hand (use <Button> / .ag-btn)",
    re: /var\(--grad-btn-(primary|dark)\)|var\(--th-btn-ghost-bg\)/,
    allow: [
      "styles/global.css",
      "styles/theme.css",
      // A chip inside the mocked app screen, styled like the app, not a site button.
      "components/HowItWorks.tsx",
    ],
  },
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(astro|tsx|ts|css)$/.test(name)) out.push(p);
  }
  return out;
}

const failures = [];
for (const file of walk(root)) {
  const rel = relative(root, file);
  const text = readFileSync(file, "utf8");
  for (const rule of rules) {
    if (rule.allow.includes(rel)) continue;
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (rule.re.test(line)) failures.push(`${rel}:${i + 1}  ${rule.name}`);
    });
  }
}

if (failures.length) {
  console.error("check-ui-primitives: the following lines re-draw a shared primitive:\n");
  for (const f of failures) console.error("  " + f);
  console.error("\nUse the component instead (Section, Badge, Button) or add the file to the allow list with a reason.");
  process.exit(1);
}
console.log(`check-ui-primitives: ok (${rules.length} rules)`);
