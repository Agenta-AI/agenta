/** Attachment copies live on the command sandbox's drive, never on the runner disk. */
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type {
  AttachmentFiles,
  AttachmentPath,
} from "../../sandbox_agent/attachments.ts";
import { shellQuote } from "../../sandbox_agent/mount.ts";
import type { ConversationWorkspace } from "../conversation-workspace.ts";
import type { SandboxRequirements } from "../sandbox/command-sandbox.ts";
import type { DaytonaSandbox } from "../sandbox/daytona-api.ts";
import { INLINE_BYTES } from "../sandbox/sandbox-files.ts";

const HELPER = String.raw`
import base64, json, os, shutil, stat, sys
op, root, directory, path = sys.argv[1:5]
def checked(p):
    try: st = os.lstat(p)
    except FileNotFoundError: return None
    if stat.S_ISLNK(st.st_mode): raise ValueError("attachment path contains a symbolic link")
    return st
for p in (root, directory):
    st = checked(p)
    if st is not None and not stat.S_ISDIR(st.st_mode): raise ValueError("attachment parent is not a directory")
st = checked(path)
if st is not None and not stat.S_ISREG(st.st_mode): raise ValueError("attachment is not a regular file")
if st is not None:
    print(json.dumps("exists")); sys.exit(0)
if op == "exists":
    print(json.dumps("missing")); sys.exit(0)
for p in (root, directory):
    os.makedirs(p, exist_ok=True)
    checked(p)
staged, data, token = sys.argv[5:8]
tmp = path + "." + token + ".tmp"
try:
    with open(tmp, "xb") as dst:
        if staged == "-": dst.write(base64.b64decode(data))
        else:
            with open(staged, "rb") as src: shutil.copyfileobj(src, dst)
        dst.flush()
        os.fsync(dst.fileno())
    # The workspace serializes this with tool writes. Like Daytona attachment delivery,
    # an external writer can still race this last check and rename.
    if checked(path) is not None:
        print(json.dumps("exists"))
    else:
        os.rename(tmp, path)
        # Persist the renamed key before reporting delivery (geesefs uploads on close).
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        try: os.fsync(fd)
        finally: os.close(fd)
        print(json.dumps("written"))
finally:
    try: os.unlink(tmp)
    except FileNotFoundError: pass
`;

export function attachmentFiles(
  workspace: ConversationWorkspace,
  requirements: SandboxRequirements,
): AttachmentFiles {
  const paths = (path: AttachmentPath) =>
    [path.root, path.directory, path.absolute].map((p) =>
      workspace.inSandbox(p),
    );
  const run = async (sandbox: DaytonaSandbox, args: string[]) => {
    const result = await sandbox.run(
      `python3 -c ${shellQuote(HELPER)} ${args.map(shellQuote).join(" ")}`,
      { timeoutSeconds: 60 },
    );
    if (result.exitCode !== 0)
      throw new Error(
        `attachment filesystem operation failed: ${result.output.slice(-300)}`,
      );
    const status: unknown = JSON.parse(
      result.output.trim().split("\n").at(-1) ?? "",
    );
    if (status !== "exists" && status !== "written" && status !== "missing")
      throw new Error("invalid attachment filesystem result");
    return status;
  };
  return {
    exists: (path) =>
      workspace.read(
        requirements,
        undefined,
        async (sandbox) =>
          (await run(sandbox, ["exists", ...paths(path)])) === "exists",
      ),
    materialize: (path, bytes) =>
      workspace.change(requirements, undefined, async (sandbox) => {
        const token = randomUUID();
        const large = bytes.byteLength > INLINE_BYTES;
        const staged = `${workspace.tmpDir}/.agenta-attachment-${token}`;
        try {
          if (large)
            await sandbox.upload(Readable.from([Buffer.from(bytes)]), staged);
          const result = await run(sandbox, [
            "write",
            ...paths(path),
            large ? staged : "-",
            large ? "" : Buffer.from(bytes).toString("base64"),
            token,
          ]);
          if (result === "missing")
            throw new Error("attachment was not written");
          return result;
        } finally {
          if (large)
            await sandbox
              .run(`rm -f -- ${shellQuote(staged)}`, { timeoutSeconds: 15 })
              .catch(() => {});
        }
      }),
  };
}
