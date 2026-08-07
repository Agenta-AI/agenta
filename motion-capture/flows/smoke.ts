import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { defineFlow } from "../scripts/lib/flow";

/**
 * Offline pipeline smoke test — drives a local HTML fixture (no cloud, no auth).
 * Proves record → convert → render and the fake-cursor/zoom end to end.
 * Run: pnpm clip smoke
 */
const FIXTURE = pathToFileURL(
  path.resolve(import.meta.dirname, "..", "scripts", "fixtures", "smoke.html"),
).href;

export default defineFlow({
  name: "smoke",
  viewport: { width: 1920, height: 1080 },
  run: async (ctx) => {
    const { page, typeInto, moveAndClick, pause } = ctx;
    await page.goto(FIXTURE, { waitUntil: "domcontentloaded" });
    await pause(700);
    await typeInto("#prompt", "Summarize a customer support ticket", "prompt");
    await pause(700);
    await moveAndClick("#create", "Create agent");
    await pause(1200);
  },
});
