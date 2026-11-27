import type { MountCredentials } from "../../src/engines/sandbox_agent/mount.ts";

/**
 * A fake engine's answer to the warm-path drive sign: the drive still signs. Fake environments
 * carry no drives, so this is called only by a test that adds some.
 */
export async function driveSigns(): Promise<MountCredentials | null> {
  return {
    region: "us-east-1",
    bucket: "b",
    prefix: "mounts/proj/drive",
    accessKey: "AK",
    secretKey: "SK",
  };
}
