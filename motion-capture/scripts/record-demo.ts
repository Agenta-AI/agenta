/**
 * Records ONE flow with Playwright and writes:
 *   recordings/<name>.webm         — the raw screen recording (with fake cursor)
 *   public/<name>.clicks.json      — click log the Remotion composition reads
 *
 * Usage: pnpm record <flow-name>            (default: create-agent)
 * Requires: storageState.json (run `pnpm auth` once) and AGENTA_BASE_URL in .env.
 */
import { chromium } from "playwright";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import "dotenv/config";
import type { Flow, ClickEvent } from "./lib/flow";
import { buildContext, CURSOR_INIT_SCRIPT } from "./lib/recorder";

const ROOT = path.resolve(import.meta.dirname, "..");
const RECORDINGS = path.join(ROOT, "recordings");
const PUBLIC = path.join(ROOT, "public");
const STATE = path.join(ROOT, "storageState.json");

async function main() {
  const name = process.argv[2] ?? "create-agent";
  const baseURL = process.env.AGENTA_BASE_URL;
  if (!baseURL) {
    throw new Error("AGENTA_BASE_URL is not set. Copy .env.example to .env and set it.");
  }

  const flowPath = path.join(ROOT, "flows", `${name}.ts`);
  if (!fs.existsSync(flowPath)) throw new Error(`No flow file at flows/${name}.ts`);
  const flow: Flow = (await import(pathToFileURL(flowPath).href)).default;

  fs.mkdirSync(RECORDINGS, { recursive: true });
  fs.mkdirSync(PUBLIC, { recursive: true });

  const browser = await chromium.launch({ headless: true, slowMo: 40 });
  const context = await browser.newContext({
    viewport: flow.viewport,
    deviceScaleFactor: 1,
    recordVideo: { dir: RECORDINGS, size: flow.viewport },
    storageState: fs.existsSync(STATE) ? STATE : undefined,
  });
  await context.addInitScript({ content: CURSOR_INIT_SCRIPT });

  const page = await context.newPage();
  const clicks: ClickEvent[] = [];
  const startedAt = Date.now();
  const getElapsedMs = () => Date.now() - startedAt;

  const ctx = buildContext(page, baseURL, clicks, getElapsedMs);

  try {
    // Lead-in anchor: gives the recording a beat before the first action so the
    // wall-clock click times line up better with recorded video frames.
    await page.waitForTimeout(800);
    await flow.run(ctx);
    await page.waitForTimeout(1200); // tail hold
  } finally {
    const durationMs = getElapsedMs();
    const video = page.video();
    await context.close(); // flushes the video file
    await browser.close();

    if (video) {
      const src = await video.path();
      const dest = path.join(RECORDINGS, `${name}.webm`);
      fs.renameSync(src, dest);
      console.log(`recording  -> ${path.relative(ROOT, dest)}`);
    }

    const log = {
      name,
      viewport: flow.viewport,
      durationMs,
      offsetMs: 0,
      clicks,
    };
    const jsonPath = path.join(PUBLIC, `${name}.clicks.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(log, null, 2) + "\n");
    console.log(`click log  -> ${path.relative(ROOT, jsonPath)} (${clicks.length} clicks)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
