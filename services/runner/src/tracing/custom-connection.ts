/**
 * Whether the user's own model connection serves a run, so its model spans carry
 * CUSTOM_CONNECTION and neither the runner nor the platform prices them from a public price list.
 *
 * The SDK resolver knows which vault record it chose and states it as `customConnection`. The
 * route cannot say it: a custom-provider record at its family's registered base URL looks like a
 * provider key. An SDK that predates the field is read from its deployment alone, where `custom`
 * is the user's own endpoint.
 */
import type { ModelConnection } from "../protocol.ts";

export function servedByCustomConnection(
  connection?: Pick<ModelConnection, "deployment" | "customConnection">,
): boolean {
  if (typeof connection?.customConnection === "boolean") {
    return connection.customConnection;
  }
  return connection?.deployment?.trim().toLowerCase() === "custom";
}
