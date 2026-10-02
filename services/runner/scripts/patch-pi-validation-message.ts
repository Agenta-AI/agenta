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
import { readFileSync } from "node:fs";

import {
  applyPiValidationMessagePatch,
  PI_VALIDATION_BUNDLE_PATH,
} from "../src/tools/pi-validation-patch.ts";
import { piAiBundlePaths, writeBundle } from "./pi-ai-bundles.ts";

const bundles = piAiBundlePaths(PI_VALIDATION_BUNDLE_PATH);
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
  writeBundle(bundle, outcome.source);
  console.log(
    `patch-pi-validation-message: an unexpected property now names the key in ${bundle}`,
  );
}
