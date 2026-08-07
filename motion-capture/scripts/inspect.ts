/**
 * Dev helper: load an authenticated page (reusing storageState) and dump its
 * structure so we can find stable selectors for a flow. Not part of the pipeline.
 *
 * Usage: pnpm exec tsx scripts/inspect.ts [path]   (default path: /)
 */
import { chromium } from "playwright";
import * as fs from "node:fs";
import * as path from "node:path";
import "dotenv/config";

const ROOT = path.resolve(import.meta.dirname, "..");
const STATE = path.join(ROOT, "storageState.json");

async function main() {
  const baseURL = process.env.AGENTA_BASE_URL!;
  const rel = process.argv[2] ?? "/";
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    storageState: fs.existsSync(STATE) ? STATE : undefined,
  });
  const page = await context.newPage();
  await page.goto(new URL(rel, baseURL).href, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);

  console.log("FINAL URL:", page.url());
  console.log("TITLE:", await page.title());

  const dump = await page.evaluate(() => {
    const txt = (el: Element) => (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60);
    const q = (sel: string) => Array.from(document.querySelectorAll(sel));
    return {
      buttons: q("button").map((b) => txt(b)).filter(Boolean).slice(0, 60),
      tabs: q('[role="tab"], .ant-tabs-tab').map((t) => txt(t)).filter(Boolean).slice(0, 40),
      links: q("a[href]").map((a) => `${txt(a)} -> ${a.getAttribute("href")}`).filter(Boolean).slice(0, 60),
      inputs: q("input,textarea").map((i) => (i as HTMLInputElement).placeholder || (i as HTMLElement).getAttribute("aria-label") || "").filter(Boolean).slice(0, 30),
      headings: q("h1,h2,h3").map((h) => txt(h)).filter(Boolean).slice(0, 30),
      testids: q("[data-testid]").map((e) => e.getAttribute("data-testid")).filter(Boolean).slice(0, 60),
    };
  });
  console.log(JSON.stringify(dump, null, 2));

  fs.mkdirSync("/tmp/agenta-inspect", { recursive: true });
  const shot = `/tmp/agenta-inspect/${rel.replace(/[^a-z0-9]+/gi, "_") || "root"}.png`;
  await page.screenshot({ path: shot, fullPage: false });
  console.log("SHOT:", shot);

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
