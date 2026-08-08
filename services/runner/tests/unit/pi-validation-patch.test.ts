import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  applyPiValidationMessagePatch,
  injectedSource,
  INJECTED_FN_NAME,
  piValidationMessage,
  STOCK_MAP_LINE,
} from "../../src/tools/pi-validation-patch.ts";

/**
 * Verbatim from the installed bundle (`@earendil-works/pi-ai` 0.80.6,
 * `dist/utils/validation.js`). Keep it byte-exact: the patch's only job is to rewrite this shape,
 * so a fixture that drifts from the real bundle proves nothing.
 */
const VALIDATION_SECTION = `function formatValidationPath(error) {
    if (error.keyword === "required") {
        const requiredProperties = error.params.requiredProperties;
        const requiredProperty = requiredProperties?.[0];
        if (requiredProperty) {
            const basePath = error.instancePath.replace(/^\\//, "").replace(/\\//g, ".");
            return basePath ? \`\${basePath}.\${requiredProperty}\` : requiredProperty;
        }
    }
    const path = error.instancePath.replace(/^\\//, "").replace(/\\//g, ".");
    return path || "root";
}
export function validateToolArguments(tool, toolCall) {
    if (validator.Check(args)) {
        return args;
    }
    const errors = validator
        .Errors(args)
${STOCK_MAP_LINE}
        .join("\\n") || "Unknown validation error";
    const errorMessage = \`Validation failed for tool "\${toolCall.name}":\\n\${errors}\`;
    throw new Error(errorMessage);
}
`;

/**
 * A typebox `additionalProperties` error, exactly as typebox 1.1.38 reports one. Captured by
 * compiling a closed nested schema and reading `validator.Errors(...)`, which is what Pi does.
 * The offending keys arrive in `params`, never in `instancePath`, which is the whole reason the
 * stock message could not name them.
 */
const extraPropertyError = (keys: string[]) => ({
  keyword: "additionalProperties",
  instancePath: "/workflow_revision",
  params: { additionalProperties: keys },
  message: "must not have additional properties",
});

/** The formatter as it runs INSIDE Pi: evaluated from the text the patch injects. */
function patchedFormatter(): (error: unknown) => string {
  const factory = new Function(
    `${injectedSource()}\nreturn ${INJECTED_FN_NAME};`,
  ) as () => (error: unknown) => string;
  return factory();
}

describe("the patched Pi validation message", () => {
  it("names the offending property, which is the whole point", () => {
    // The live QA symptom: "workflow_revision: must not have additional properties" told the model
    // an object had an extra key and left it to guess which.
    const message = patchedFormatter()(extraPropertyError(["description"]));

    assert.match(message, /'description'/);
    assert.match(message, /unexpected property/);
    assert.match(message, /Remove it from this object/);
    assert.doesNotMatch(message, /must not have additional properties/);
  });

  it("names every offending property when there is more than one", () => {
    const message = patchedFormatter()(
      extraPropertyError(["description", "extra"]),
    );

    assert.match(message, /'description', 'extra'/);
    assert.match(message, /unexpected properties/);
    assert.match(message, /Remove them from this object/);
  });

  it("leaves every other validation error exactly as typebox worded it", () => {
    // The patch is message formatting for ONE keyword. A missing required field already names the
    // field through Pi's own path formatter, and nothing here may disturb it.
    const format = patchedFormatter();
    assert.equal(
      format({
        keyword: "required",
        params: { requiredProperties: ["message"] },
        message: "must have required properties message",
      }),
      "must have required properties message",
    );
    assert.equal(
      format({ keyword: "type", params: {}, message: "must be string" }),
      "must be string",
    );
  });

  it("falls back to the stock message when the keys are absent", () => {
    // Defensive: a typebox version that stops populating `params` must degrade to today's message
    // rather than throw while formatting an error.
    const format = patchedFormatter();
    assert.equal(
      format({
        keyword: "additionalProperties",
        params: {},
        message: "must not have additional properties",
      }),
      "must not have additional properties",
    );
    assert.equal(
      format({
        keyword: "additionalProperties",
        params: { additionalProperties: [] },
        message: "must not have additional properties",
      }),
      "must not have additional properties",
    );
  });

  it("injects the same function the module exports, so the two cannot drift", () => {
    // The injected text is derived from `piValidationMessage` itself. If someone edits the
    // exported function, the patched bundle changes with it.
    const injected = patchedFormatter();
    for (const keys of [["a"], ["a", "b"]]) {
      assert.equal(
        injected(extraPropertyError(keys)),
        piValidationMessage(extraPropertyError(keys)),
      );
    }
  });
});

describe("applyPiValidationMessagePatch", () => {
  it("routes the message through the injected formatter", () => {
    const outcome = applyPiValidationMessagePatch(VALIDATION_SECTION);

    assert.equal(outcome.kind, "patched");
    const patched = (outcome as { source: string }).source;
    assert.match(patched, /\$\{__agentaValidationMessage\(error\)\}/);
    assert.doesNotMatch(patched, /\$\{error\.message\}/);
    assert.ok(
      patched.includes(`function ${INJECTED_FN_NAME}(error)`),
      "the formatter is defined in the bundle it is called from",
    );
  });

  it("defines the formatter before it is used", () => {
    // A function declaration hoists, but reading the source in order is how the next person
    // checks this patch, and a definition after its call site reads like a bug.
    const patched = (
      applyPiValidationMessagePatch(VALIDATION_SECTION) as { source: string }
    ).source;

    assert.ok(
      patched.indexOf(`function ${INJECTED_FN_NAME}`) <
        patched.indexOf(`${INJECTED_FN_NAME}(error)}`),
    );
  });

  it("changes nothing else in the bundle", () => {
    const patched = (
      applyPiValidationMessagePatch(VALIDATION_SECTION) as { source: string }
    ).source;
    const restored = patched
      .replace(`${injectedSource()}`, "")
      .replace(
        `\${${INJECTED_FN_NAME}(error)}`,
        "${error.message}",
      );

    assert.equal(restored, VALIDATION_SECTION);
  });

  it("is idempotent, so a rebuilt or already-baked image is a no-op", () => {
    const once = applyPiValidationMessagePatch(VALIDATION_SECTION) as {
      source: string;
    };
    assert.equal(
      applyPiValidationMessagePatch(once.source).kind,
      "already-patched",
    );
  });

  it("reports anchor-missing when Pi changes its formatter, so the build fails loudly", () => {
    // The retirement path too: when upstream names the key itself, the anchor stops matching and
    // the build says so instead of shipping a patch that no longer applies.
    assert.equal(
      applyPiValidationMessagePatch(
        VALIDATION_SECTION.replace(STOCK_MAP_LINE, "        .map(format)"),
      ).kind,
      "anchor-missing",
    );
    assert.equal(
      applyPiValidationMessagePatch(
        VALIDATION_SECTION.replace("function formatValidationPath(error) {", ""),
      ).kind,
      "anchor-missing",
    );
  });
});
