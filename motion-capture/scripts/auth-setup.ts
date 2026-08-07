/**
 * Assisted login. Opens a REAL (headed) browser at AGENTA_BASE_URL and waits for
 * YOU to log in (type the password yourself — the script never does). It then
 * auto-detects the authenticated app (URL leaves /auth and lands under /w), lets
 * data settle, and saves the session to storageState.json for the recorder to
 * reuse. No terminal ENTER needed, so it can be launched for you.
 *
 * Usage: pnpm auth
 */
import { chromium } from "playwright";
import * as path from "node:path";
import "dotenv/config";

const ROOT = path.resolve(import.meta.dirname, "..");
const STATE = path.join(ROOT, "storageState.json");

const BANNER = `
(() => {
  if (document.getElementById('pw-auth-banner')) return;
  const b = document.createElement('div');
  b.id = 'pw-auth-banner';
  b.textContent = 'Log in here (email + password), then skip onboarding. This window saves your session automatically — do not close it.';
  b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#facc15;color:#111;'
    + 'font:600 14px system-ui,sans-serif;padding:10px 16px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.25);';
  document.body.appendChild(b);
})();
`;

async function main() {
  const baseURL = process.env.AGENTA_BASE_URL;
  if (!baseURL) throw new Error("AGENTA_BASE_URL is not set. Copy .env.example to .env and set it.");

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });
  await page.addInitScript({ content: BANNER });
  await page.evaluate(BANNER).catch(() => {});

  console.log(`\nBrowser opened at ${baseURL}. Log in there (email + password), skip onboarding.`);
  console.log("Waiting for successful login (up to 5 min)…\n");

  // Auth is done once we leave /auth and reach an app route under /w.
  await page.waitForURL(
    (url) => {
      const p = new URL(url).pathname;
      return p.startsWith("/w") && !p.startsWith("/auth");
    },
    { timeout: 300000 },
  );

  // Let onboarding-skip + first data load settle so the saved session is "warm".
  await page.waitForTimeout(8000);
  await context.storageState({ path: STATE });
  console.log(`\n✅ Session saved -> ${path.relative(ROOT, STATE)}`);

  await browser.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
