/**
 * The whole pipeline for one clip in a single command: record -> convert -> render.
 * This is the "regenerate after a UI change" button.
 *
 * Usage: pnpm clip <flow-name>   (default: create-agent)
 */
import { execFileSync } from "node:child_process";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");

function step(script: string, name: string) {
  console.log(`\n=== ${script} ${name} ===`);
  execFileSync(TSX, [path.join(ROOT, "scripts", script), name], { stdio: "inherit" });
}

const name = process.argv[2] ?? "create-agent";
step("record-demo.ts", name);
step("convert.ts", name);
step("render.ts", name);
console.log(`\nDone. See out/${name}.mp4 and out/${name}.webm`);
