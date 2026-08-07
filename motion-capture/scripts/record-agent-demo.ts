/**
 * Records the agent demo. Uses a PERSISTENT browser profile so you log in only
 * ONCE — after that the session lives in the profile on disk and every rerun
 * (headed or headless) reuses it with no login. This sidesteps the broken
 * storageState reuse (frontend :3000 / API :80 are different origins).
 *
 *  - First run (profile empty): a window opens with the email pre-filled; YOU
 *    type the password + skip onboarding (I never type the password). Once the
 *    playground's "Model & harness" is visible, the demo drives itself and I trim
 *    the login out.
 *  - Later runs: already authenticated — set HEADLESS=1 to iterate silently.
 *
 * Writes recordings/agent-demo.webm, public/agent-demo.clicks.json, and
 * /tmp/agenta-inspect/step-*.png diagnostics.
 */
import { chromium } from "playwright";
import * as fs from "node:fs";
import * as path from "node:path";
import "dotenv/config";
import type { ClickEvent } from "./lib/flow";
import { buildContext, CURSOR_INIT_SCRIPT } from "./lib/recorder";
import { softFirst, SelectorError } from "./lib/selectors";
import flow from "../flows/agent-demo";
import { sel } from "../flows/agent-demo.selectors";

const ROOT = path.resolve(import.meta.dirname, "..");
const RECORDINGS = path.join(ROOT, "recordings");
const PUBLIC = path.join(ROOT, "public");
const PROFILE = path.join(ROOT, ".session-profile");
const URL_FILE = path.join(PROFILE, "playground-url.txt");
const DIAG = "/tmp/agenta-inspect";

const BANNER = `
(() => {
  const set = () => {
    if (document.getElementById('pw-auth-banner') || !document.body) return;
    const b = document.createElement('div');
    b.id = 'pw-auth-banner';
    b.textContent = 'Type the PASSWORD + submit, then skip onboarding. When the playground loads the demo records automatically — then do not touch the mouse.';
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#facc15;color:#111;font:600 13px system-ui,sans-serif;padding:8px 14px;text-align:center;';
    document.body.appendChild(b);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', set); else set();
})();
`;

async function anyOpenerVisible(page: import("playwright").Page): Promise<boolean> {
  return (await softFirst(sel.openers(page))) !== null;
}

async function main() {
  const baseURL = process.env.AGENTA_BASE_URL;
  if (!baseURL) throw new Error("AGENTA_BASE_URL not set (motion-capture/.env).");
  const headless = process.env.HEADLESS === "1";
  const check = process.argv.includes("--check");
  for (const d of [RECORDINGS, PUBLIC, PROFILE, DIAG]) fs.mkdirSync(d, { recursive: true });
  if (check) console.log("— selector check (dry run: drives the flow, no video, no artifacts) —");

  const context = await chromium.launchPersistentContext(PROFILE, {
    headless,
    // Small slowMo only — 30ms was multiplied across every mouse.move in a glide,
    // making the cursor crawl. The eased glide provides smoothness on its own.
    slowMo: 6,
    viewport: flow.viewport,
    deviceScaleFactor: 1,
    // --check verifies selectors only; skip video capture entirely.
    recordVideo: check ? undefined : { dir: RECORDINGS, size: flow.viewport },
  });
  const recStart = Date.now();
  await context.addInitScript({ content: CURSOR_INIT_SCRIPT });
  // Banner only helps during a first-time login; it would otherwise pollute the
  // recorded demo (re-injects on every page), so only add it when not authed yet.
  if (!check && !fs.existsSync(URL_FILE)) await context.addInitScript({ content: BANNER });

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  // Authenticated already (persistent profile) or need to log in?
  if (page.url().includes("/auth")) {
    try {
      const email = page.getByPlaceholder(/email/i).first();
      await email.waitFor({ state: "visible", timeout: 15000 });
      await email.fill("ashraf@gmail.com");
      await page.getByRole("button", { name: /^continue$/i }).first().click();
      console.log("\nEmail filled. TYPE THE PASSWORD in the window + submit, then skip onboarding.\n");
    } catch {
      console.log("\nLog in fully in the window.\n");
    }
  } else if (fs.existsSync(URL_FILE)) {
    // Reuse run: jump straight to the saved playground.
    const saved = fs.readFileSync(URL_FILE, "utf8").trim();
    if (saved) await page.goto(saved, { waitUntil: "domcontentloaded" }).catch(() => {});
  }

  // Wait for the playground opener (login + onboarding may be happening).
  const waitStart = Date.now();
  let ready = false;
  while (Date.now() - waitStart < 300000) {
    if (await anyOpenerVisible(page)) { ready = true; break; }
    await page.waitForTimeout(500);
  }
  if (!ready) {
    await page.screenshot({ path: path.join(DIAG, "agent-demo-noopener.png") }).catch(() => {});
    await context.close();
    throw new Error("'Model & harness' opener never appeared — see /tmp/agenta-inspect/agent-demo-noopener.png");
  }
  fs.writeFileSync(URL_FILE, page.url()); // remember the playground for reuse runs

  // Ensure Model & harness starts COLLAPSED (pre-demo, trimmed) so the in-demo
  // expand reads cleanly and the toggle is deterministic.
  try {
    const header = await softFirst(sel.modelHarnessHeader(page));
    if (header && (await header.getAttribute("aria-expanded")) === "true") {
      const b = await header.boundingBox();
      if (b) {
        await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
        await page.waitForTimeout(800);
      }
    }
  } catch {
    /* best effort */
  }

  await page.waitForTimeout(600);
  const demoStart = Date.now();
  const clicks: ClickEvent[] = [];
  const ctx = buildContext(page, baseURL, clicks, () => Date.now() - demoStart);

  let ok = true;
  try {
    await flow.run(ctx);
    await page.waitForTimeout(check ? 200 : 1200);
  } catch (err) {
    ok = false;
    if (err instanceof SelectorError) {
      console.error(`\nSELECTOR FAILED — ${err.message}\n\n→ Fix this target's candidates in flows/agent-demo.selectors.ts`);
    } else {
      console.error("Demo step failed:", err);
    }
    await page.screenshot({ path: path.join(DIAG, "agent-demo-fail.png") }).catch(() => {});
    fs.writeFileSync(path.join(DIAG, "agent-demo-fail.html"), await page.content().catch(() => ""));
  } finally {
    const durationMs = Date.now() - demoStart;
    const trimBeforeMs = demoStart - recStart;
    const video = page.video();
    await context.close();

    if (check) {
      // Dry run: verify selectors only — never write a recording or click log.
      console.log(
        ok
          ? "\nall selectors resolved ✓"
          : "\nselector check FAILED ✗ — see /tmp/agenta-inspect/agent-demo-fail.png",
      );
      process.exitCode = ok ? 0 : 1;
      return;
    }

    if (video) {
      const src = await video.path();
      fs.renameSync(src, path.join(RECORDINGS, "agent-demo.webm"));
      console.log("recording  -> recordings/agent-demo.webm");
    }
    const log = { name: "agent-demo", viewport: flow.viewport, durationMs, trimBeforeMs, offsetMs: 0, clicks };
    fs.writeFileSync(path.join(PUBLIC, "agent-demo.clicks.json"), JSON.stringify(log, null, 2) + "\n");
    console.log(`click log  -> public/agent-demo.clicks.json (${clicks.length} clicks, trim ${(trimBeforeMs / 1000).toFixed(1)}s)`);
    if (!ok) process.exitCode = 1;
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
