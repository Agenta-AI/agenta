/**
 * True when `moduleUrl` is the process entry point, so an entrypoint module runs its `main()`
 * under `tsx src/x.ts` but stays inert when imported by a test. Compares the resolved real
 * paths of `process.argv[1]` and the module's own file.
 */
import { argv } from "node:process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function isEntrypoint(moduleUrl: string): boolean {
  if (!argv[1]) return false;
  try {
    return realpathSync(argv[1]) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
