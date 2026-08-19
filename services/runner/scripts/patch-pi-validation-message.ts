/**
 * Name the offending key when Pi rejects a tool call for an unexpected property.
 *
 * Runs in the runner image build, after `pnpm install`, so the baked copy of
 * `@earendil-works/pi-ai` tells a model WHICH property to remove instead of only that the object
 * has one too many. See `src/tools/pi-validation-patch.ts` for why, for the scope this does not
 * cover, and for how the patch retires once upstream lands it.
 *
 * Exits non-zero when the package is missing or its formatter no longer matches the anchor, so a
 * Pi version bump breaks the image build instead of silently restoring the unactionable message.
 *
 *   tsx scripts/patch-pi-validation-message.ts
 */
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  applyPiValidationMessagePatch,
  PI_VALIDATION_BUNDLE_PATH,
} from "../src/tools/pi-validation-patch.ts";

const PI_AI = join("@earendil-works", "pi-ai");

/**
 * Every installed copy of the file.
 *
 * `require.resolve` is not usable here: neither Pi package declares an `exports` entry for its
 * `package.json`, and `pi-ai` is not hoisted to the top level, so both lookups throw. What is
 * stable is the layout. `node_modules/@earendil-works/pi-coding-agent` is a symlink into the pnpm
 * store, and the `pi-ai` its own resolution uses is its sibling inside that same store entry, so
 * one `realpath` finds the copy Node would actually load.
 *
 * The store is also swept for any other copy, because a build-time patch should leave no
 * unpatched duplicate behind for a different peer set to resolve to.
 */
function validationBundlePaths(): string[] {
  const found = new Set<string>();
  const add = (dir: string): void => {
    const bundle = join(dir, PI_VALIDATION_BUNDLE_PATH);
    if (existsSync(bundle)) found.add(realpathSync(bundle));
  };

  try {
    const real = realpathSync(join("node_modules", "@earendil-works", "pi-coding-agent"));
    add(join(dirname(dirname(real)), PI_AI));
  } catch {
    // Not installed at the top level; the store sweep below still covers it.
  }
  add(join("node_modules", PI_AI));

  try {
    const store = join("node_modules", ".pnpm");
    for (const entry of readdirSync(store)) {
      add(join(store, entry, "node_modules", PI_AI));
    }
  } catch {
    // No pnpm store (a different installer, or a pruned image); the paths above are the answer.
  }
  return [...found];
}

const bundles = validationBundlePaths();
if (bundles.length === 0) {
  console.error(
    "patch-pi-validation-message: no installed @earendil-works/pi-ai validation bundle found. " +
      "Run `pnpm install` first, or drop this step if Pi is no longer a dependency.",
  );
  process.exit(1);
}

for (const bundle of bundles) {
  const outcome = applyPiValidationMessagePatch(readFileSync(bundle, "utf8"));
  if (outcome.kind === "anchor-missing") {
    console.error(
      `patch-pi-validation-message: the validation formatter anchor is missing in ${bundle}. ` +
        "pi-ai changed how it formats validation errors: re-verify the message shape and update " +
        "src/tools/pi-validation-patch.ts (or drop the patch if upstream now names the key).",
    );
    process.exit(1);
  }
  if (outcome.kind === "already-patched") {
    console.log(`patch-pi-validation-message: already naming the key in ${bundle}`);
    continue;
  }
  writeFileSync(bundle, outcome.source);
  console.log(
    `patch-pi-validation-message: an unexpected property now names the key in ${bundle}`,
  );
}
