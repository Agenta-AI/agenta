/**
 * The runner images run as `node`, so every durable root a provider creates session folders
 * under on the runner host must be baked writable before `USER node` (QAP-1: `inprocess` failed
 * every turn with EACCES under /home/sandbox/agenta once the dev image stopped running as root).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DAYTONA_DURABLE_MOUNT_ROOT, LOCAL_DURABLE_MOUNT_ROOT } from "../../src/engines/sandbox_agent/run-plan.ts";

describe.each(["Dockerfile.dev", "Dockerfile.gh"])("%s", (name) => {
  const text = readFileSync(join(__dirname, "..", "..", "docker", name), "utf-8");
  const beforeUser = text.slice(0, text.lastIndexOf("\nUSER node"));
  it.each([LOCAL_DURABLE_MOUNT_ROOT, DAYTONA_DURABLE_MOUNT_ROOT])("bakes %s/mounts writable for any uid before dropping root", (root) => {
    expect(beforeUser).toContain(`mkdir -p ${root}/mounts && chmod 1777 ${root} ${root}/mounts`);
  });
});
