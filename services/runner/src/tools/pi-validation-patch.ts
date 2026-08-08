/**
 * Build-time patch for Pi's tool-argument validation message (`@earendil-works/pi-ai`).
 *
 * WHY THIS EXISTS. Pi validates a tool call against the advertised JSON schema with typebox,
 * before it dispatches, and formats each failure as `  - <path>: <message>`. For a closed object
 * that message is typebox's `must not have additional properties`, which names the OBJECT and not
 * the offending key. A model then reads "workflow_revision: must not have additional properties"
 * and has to guess which of the properties it sent is the extra one. Mahmoud watched exactly that
 * in live QA.
 *
 * The key is not missing, only unused. typebox reports it:
 *
 *   { keyword: "additionalProperties", instancePath: "/workflow_revision",
 *     params: { additionalProperties: ["description"] }, message: "must not have..." }
 *
 * Pi already special-cases the `required` keyword to name the missing property from
 * `params.requiredProperties`. This patch gives `additionalProperties` the same treatment, from
 * `params.additionalProperties`. It is message formatting only. It changes no validation logic, so
 * a call that failed still fails and a call that passed still passes.
 *
 * SCOPE, STATED PLAINLY. This patches the copy of Pi that ships in the RUNNER image, so it covers
 * runs where Pi executes on the runner host. A Daytona run executes Pi inside the sandbox image
 * from its own install, which this does not reach. That half needs the same patch wherever that
 * image is built, and until then the two paths word this error differently.
 *
 * VERSION-PIN FRICTION, ACCEPTED. The anchor is the exact `.map(...)` line pi-ai 0.80.6 ships, so
 * a Pi upgrade will usually not match it and the image build will fail until someone re-reads the
 * formatter and updates the anchor here. That cost is accepted deliberately: the alternative is a
 * loose pattern that keeps matching something after the surrounding code has moved, which is how a
 * patch silently rewrites the wrong line. Whoever bumps Pi owns this file for ten minutes.
 *
 * RETIREMENT. Send it upstream to Pi and drop this once an accepted release ships it.
 * `applyPiValidationMessagePatch` reports `already-patched` for a source that already carries the
 * formatter, so the transition is safe.
 *
 * FAILING LOUDLY IS THE POINT. The image build calls this and exits non-zero on `anchor-missing`.
 * A Pi version whose formatter no longer matches must break the build rather than silently ship a
 * message the model cannot act on.
 */

/** The file inside the package that formats a validation failure. */
export const PI_VALIDATION_BUNDLE_PATH = "dist/utils/validation.js";

/** The name the injected function takes inside Pi's module scope. Prefixed so it cannot collide. */
export const INJECTED_FN_NAME = "__agentaValidationMessage";

/**
 * The message for one typebox validation error.
 *
 * SELF-CONTAINED ON PURPOSE. This function's own source is what the patch injects into Pi (see
 * `injectedSource`), so it must not reference anything from this module. A helper called from here
 * would be undefined inside Pi and would throw while formatting an error, which is the worst place
 * to throw.
 *
 * Written in plain JavaScript terms for the same reason: what runs inside Pi is this text.
 */
export function piValidationMessage(error: {
  keyword?: string;
  message?: string;
  params?: { additionalProperties?: unknown };
}): string {
  if (error.keyword === "additionalProperties") {
    const keys = error.params?.additionalProperties;
    if (Array.isArray(keys) && keys.length > 0) {
      const named = keys.map((key) => `'${String(key)}'`).join(", ");
      return keys.length === 1
        ? `unexpected property ${named}. Remove it from this object.`
        : `unexpected properties ${named}. Remove them from this object.`;
    }
  }
  return error.message ?? "";
}

/**
 * The exact call Pi makes today, and the call the patch replaces it with.
 *
 * The anchor covers the whole `.map(...)` line rather than just `${error.message}`: that shorter
 * string occurs elsewhere, and a patch that can bind in more than one place is a patch that can
 * bind in the wrong one.
 */
export const STOCK_MAP_LINE =
  "        .map((error) => `  - ${formatValidationPath(error)}: ${error.message}`)";

export const PATCHED_MAP_LINE =
  "        .map((error) => `  - ${formatValidationPath(error)}: ${" +
  INJECTED_FN_NAME +
  "(error)}`)";

/** Where the injected function is placed: immediately before Pi's own path formatter. */
const DEFINITION_ANCHOR = "function formatValidationPath(error) {";

/** The function text the patch writes into Pi, derived from the real function so they cannot drift. */
export function injectedSource(): string {
  return `function ${INJECTED_FN_NAME}(error) ${bodyOf(piValidationMessage)}\n`;
}

/** The body of `fn`, from its own source. Keeping the derivation here keeps the drift risk at zero. */
function bodyOf(fn: (...args: never[]) => unknown): string {
  const source = fn.toString();
  const start = source.indexOf("{");
  if (start < 0) throw new Error("pi-validation-patch: cannot read the formatter body");
  return source.slice(start);
}

export type PiValidationPatchOutcome =
  | { kind: "patched"; source: string }
  | { kind: "already-patched" }
  | { kind: "anchor-missing" };

/**
 * Apply the patch to one `validation.js` source.
 *
 * Pure and idempotent: it reports `already-patched` rather than injecting a second copy, so a
 * rebuild over an installed image is safe.
 */
export function applyPiValidationMessagePatch(
  source: string,
): PiValidationPatchOutcome {
  if (source.includes(INJECTED_FN_NAME)) return { kind: "already-patched" };
  if (!source.includes(STOCK_MAP_LINE)) return { kind: "anchor-missing" };
  if (!source.includes(DEFINITION_ANCHOR)) return { kind: "anchor-missing" };
  const patched = source
    .replace(DEFINITION_ANCHOR, `${injectedSource()}${DEFINITION_ANCHOR}`)
    .replace(STOCK_MAP_LINE, PATCHED_MAP_LINE);
  return { kind: "patched", source: patched };
}
