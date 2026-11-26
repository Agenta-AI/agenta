import type { ToolCallbackContext } from "../../src/protocol.ts";
import type { ToolCallbackRuntime } from "../../src/tools/run-credential.ts";

/** A runtime callback whose credential never rotates, built from the wire shape. */
export function fixedToolCallback(
  callback: ToolCallbackContext,
): ToolCallbackRuntime {
  return {
    endpoint: callback.endpoint,
    credential: () => callback.authorization,
  };
}
