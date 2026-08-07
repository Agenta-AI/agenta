/**
 * Renders the DemoClip composition for <name> to both MP4 and looping WebM.
 *   out/<name>.mp4    — h264, for docs / general use
 *   out/<name>.webm   — vp8, embed with <video autoplay muted loop playsinline>
 *
 * The composition reads public/<name>.clicks.json (via calculateMetadata) for its
 * size, duration, and zoom keyframes, so we only pass the name.
 *
 * Usage: pnpm render <flow-name>   (default: create-agent)
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const REMOTION_BIN = path.join(ROOT, "node_modules", ".bin", "remotion");

function render(name: string, ext: "mp4" | "webm", extraArgs: string[]) {
  const out = path.join(ROOT, "out", `${name}.${ext}`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  execFileSync(
    REMOTION_BIN,
    ["render", "DemoClip", out, `--props=${JSON.stringify({ name })}`, ...extraArgs],
    { stdio: "inherit" },
  );
  console.log(`${ext.padEnd(4)}       -> ${path.relative(ROOT, out)}`);
}

function main() {
  const name = process.argv[2] ?? "create-agent";
  const json = path.join(ROOT, "public", `${name}.clicks.json`);
  if (!fs.existsSync(json)) throw new Error(`Missing ${path.relative(ROOT, json)} — run \`pnpm record ${name}\` then \`pnpm convert ${name}\`.`);
  const mp4 = path.join(ROOT, "public", `${name}.mp4`);
  if (!fs.existsSync(mp4)) throw new Error(`Missing ${path.relative(ROOT, mp4)} — run \`pnpm convert ${name}\` first.`);

  render(name, "mp4", ["--crf=16"]); // higher-quality h264
  render(name, "webm", ["--codec=vp8", "--crf=18"]);
}

main();
