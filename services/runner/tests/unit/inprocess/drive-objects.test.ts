/**
 * Calls that arrive together share one credential refresh, and none of them loses the client it
 * is sending on (CodeRabbit on PR 7124: the skill snapshot puts 8 files at a time).
 */
import { describe, expect, it } from "vitest";
import { DriveObjects } from "../../../src/engines/inprocess/workspace/drive-objects.ts";
import type { MountCredentials } from "../../../src/engines/sandbox_agent/mount.ts";

const creds = (expiresInMs: number): MountCredentials =>
  ({
    bucket: "b",
    prefix: "p/pi-sessions",
    region: "us-east-1",
    // Nothing listens here: each call fails fast, after it asked for its client.
    endpoint: "http://127.0.0.1:1",
    accessKey: "a",
    secretKey: "s",
    expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
  }) as MountCredentials;

describe("DriveObjects credentials", () => {
  it("signs once for calls that arrive together", async () => {
    let signed = 0;
    const objects = new DriveObjects(async () => {
      signed += 1;
      await new Promise((r) => setTimeout(r, 20));
      return creds(60 * 60_000);
    });
    await Promise.allSettled(Array.from({ length: 8 }, (_, i) => objects.put(`f${i}`, Buffer.from("x"))));
    expect(signed).toBe(1);
  }, 30_000);

  it("signs once again for calls that find the credentials about to expire", async () => {
    let signed = 0;
    const objects = new DriveObjects(async () => {
      signed += 1;
      await new Promise((r) => setTimeout(r, 20));
      return creds(signed === 1 ? 60_000 : 60 * 60_000);
    });
    await objects.list("").catch(() => {});
    await Promise.allSettled(Array.from({ length: 8 }, () => objects.list("")));
    expect(signed).toBe(2);
  }, 30_000);
});
