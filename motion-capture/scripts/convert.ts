/**
 * Converts recordings/<name>.webm -> public/<name>.mp4 using Remotion's BUNDLED
 * ffmpeg (no system ffmpeg needed). libx264 + yuv420p + faststart = clean input
 * for Remotion and broad player compatibility.
 *
 * Usage: pnpm convert <flow-name>   (default: create-agent)
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const REMOTION_BIN = path.join(ROOT, "node_modules", ".bin", "remotion");

function main() {
  const name = process.argv[2] ?? "create-agent";
  const input = path.join(ROOT, "recordings", `${name}.webm`);
  const output = path.join(ROOT, "public", `${name}.mp4`);
  if (!fs.existsSync(input)) throw new Error(`Missing ${path.relative(ROOT, input)} — run \`pnpm record ${name}\` first.`);

  execFileSync(
    REMOTION_BIN,
    [
      "ffmpeg",
      "-y",
      "-i", input,
      "-c:v", "libx264",
      "-crf", "20",
      "-preset", "medium",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "-an",
      output,
    ],
    { stdio: "inherit" },
  );
  console.log(`mp4        -> ${path.relative(ROOT, output)}`);
}

main();
