/**
 * The drive for tests, without an object store: the runner's folder is the drive, and a sandbox
 * "mounts" it by a link at the runner path under the sandbox's folder. The link goes when the
 * sandbox stops, as a geesefs mount does, so a start from stopped must mount again. Both views are
 * the same folder, so what these tests pin is where each tool runs, in which order, and when the
 * mount is made; a real geesefs view against a real store is pinned by
 * `tests/integration/inprocess/sandbox-drive.test.ts`. The drive's prefixes the runner writes
 * through the store (Pi's conversation file, the skill snapshot) are objects in memory.
 */
import { lstatSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { dirname } from "node:path";
import type { DaytonaSandbox } from "../../src/engines/inprocess/sandbox/daytona-api.ts";
import { DriveUnreachableError, type DriveMounter } from "../../src/engines/inprocess/sandbox/sandbox-drive.ts";
import type { ObjectStore } from "../../src/engines/inprocess/workspace/drive-objects.ts";
import type { MountCredentials } from "../../src/engines/sandbox_agent/mount.ts";
import type { LocalDaytona } from "./local-daytona.ts";

export class LinkMounter implements DriveMounter {
  /** Every mount made: which sandbox, which path. */
  readonly mounts: Array<{ sandboxId: string; path: string }> = [];
  /** When set, the store cannot be reached from the sandbox. */
  unreachable = false;

  constructor(
    private readonly daytona: LocalDaytona,
    /** The folder that plays the sandbox's "/". */
    private readonly prefix: string,
  ) {}

  mountedCheck(path: string): string {
    return `[ -L ${path} ] && ls ${path}/ >/dev/null 2>&1`;
  }

  /** A link has no cache to drop; the marker lets tests find the call. */
  refreshCommand(paths: string[]): string {
    return `: refresh-view ${paths.join(" ")}`;
  }

  async mount(sandbox: DaytonaSandbox, path: string, _creds: MountCredentials): Promise<boolean> {
    if (this.unreachable) throw new DriveUnreachableError("the store is not public and no tunnel forwards to it");
    const local = this.daytona.sandboxes.get(sandbox.id);
    if (!local || local.state !== "started") throw new Error(`sandbox ${sandbox.id} is not running`);
    const root = path.slice(this.prefix.length);
    mkdirSync(dirname(path), { recursive: true });
    const existing = (() => {
      try {
        return lstatSync(path);
      } catch {
        return undefined;
      }
    })();
    if (existing) rmSync(path, { recursive: !existing.isSymbolicLink(), force: true });
    symlinkSync(root, path);
    local.onStop.push(() => rmSync(path, { force: true }));
    this.mounts.push({ sandboxId: sandbox.id, path });
    return true;
  }
}

/** The drive's prefixes as objects in memory, shared by every store made from the same map. */
/** A hook a test sets to delay or fail a put, by the drive prefix it goes to. */
export interface ObjectFaults {
  beforePut?: (prefix: string, rel: string) => Promise<void>;
}

export function memoryObjects(prefixes: Map<string, Map<string, Buffer>> = new Map(), faults: ObjectFaults = {}) {
  return (credentials: () => MountCredentials | null | Promise<MountCredentials | null>): ObjectStore => {
    const bucket = async () => {
      const creds = await credentials();
      if (!creds) throw new Error("the drive's credentials are not available");
      let objects = prefixes.get(creds.prefix);
      if (!objects) prefixes.set(creds.prefix, (objects = new Map()));
      return objects;
    };
    return {
      get: async (rel) => (await bucket()).get(rel),
      put: async (rel, body) => {
        const objects = await bucket();
        await faults.beforePut?.((await credentials())!.prefix, rel);
        objects.set(rel, Buffer.from(body));
      },
      remove: async (rel) => void (await bucket()).delete(rel),
      list: async (relPrefix) => {
        const prefix = relPrefix ? relPrefix.replace(/\/*$/, "/") : "";
        return [...(await bucket())].filter(([rel]) => rel.startsWith(prefix)).map(([rel, body]) => ({ rel, size: body.length }));
      },
    };
  };
}

export const TEST_CREDENTIALS: MountCredentials = {
  region: "us-east-1",
  bucket: "test",
  prefix: "project/mount",
  accessKey: "test-access-key",
  secretKey: "test-secret-key",
};

/** The conversation-file prefix: signed apart from the session folder. */
export const TEST_TRANSCRIPT_CREDENTIALS: MountCredentials = { ...TEST_CREDENTIALS, prefix: "project/pi-sessions" };
