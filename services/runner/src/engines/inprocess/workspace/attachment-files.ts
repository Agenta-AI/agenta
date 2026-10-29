/**
 * Attachment copies, put on the session folder's prefix of the drive through the store, as the
 * skill snapshot is. The runner mounts nothing for `inprocess`; the command sandbox, where Pi's
 * `read` runs, sees the object after its view refresh at the first tool call of the turn.
 */
import { posix } from "node:path";
import type { AttachmentFiles } from "../../sandbox_agent/attachments.ts";
import type { ObjectStore } from "./drive-objects.ts";

export function attachmentFiles(objects: ObjectStore): AttachmentFiles {
  const exists = async (rel: string) => (await objects.list(posix.dirname(rel))).some((o) => o.rel === rel);
  return {
    exists: (path) => exists(path.relative),
    materialize: async (path, bytes) => {
      // A copy already there may hold the user's or the agent's edits: keep it.
      if (await exists(path.relative)) return "exists";
      await objects.put(path.relative, Buffer.from(bytes));
      return "written";
    },
  };
}
