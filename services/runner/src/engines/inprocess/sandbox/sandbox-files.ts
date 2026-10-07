/**
 * Pi's file operations in the command sandbox, one Daytona call each.
 *
 * All of Pi's tools run in the sandbox, on its mount of the drive: the runner never opens a path
 * the model chose. A small helper script does each operation and prints one JSON line:
 *
 * - `read`: the whole file up to `INLINE_BYTES` in the answer; a larger one is fetched with the
 *   sandbox's file download after the helper confirmed it is a regular file within the limit.
 *   Fewer bytes than the file's size is a failed read, never a short answer: a geesefs read of a
 *   file that shrank behind the mount gives up after its bounded retries and returns what it has.
 *   The helper then drops the mount's cached state of the file, so the next read sees the store.
 * - `write`: resolves a symbolic link to its target, creates the folders, writes a temporary file
 *   beside the target, `fsync`s it and renames it over the target, keeping the target's mode. The target is the old content or the
 *   new, never a part; the `fsync` makes the content reach the store before the call returns
 *   (geesefs starts the upload on close but does not wait for it). Content over `INLINE_BYTES` is
 *   uploaded to the sandbox's `/tmp` first.
 * - `ls`: what a path is, and a folder's entries with their kind, bounded.
 *
 * Only regular files are read or written; a device, pipe or socket is refused before a byte moves
 * (every open is non-blocking), so no path can stall the call.
 */
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { shellQuote } from "../../sandbox_agent/mount.ts";
import type { DaytonaSandbox } from "./daytona-api.ts";

/** Bytes that ride one call (base64 grows them by a third; one argument may be 128 KiB). */
export const INLINE_BYTES = 64 * 1024;
/** Entries one `ls` answer carries at most. */
export const LS_MAX_ENTRIES = 20_000;

const HELPER = String.raw`
import base64, errno, json, os, stat, sys
def out(**kw):
    print(json.dumps(kw)); sys.exit(0)
def fail(e):
    kind = {errno.ENOENT: "missing", errno.EISDIR: "isdir", errno.ENOTDIR: "notdir", errno.EACCES: "denied", errno.EPERM: "denied", errno.ENOTCONN: "unmounted"}.get(e.errno, "os")
    out(error=kind, message=f"{e.strerror}")
def changed():
    try: os.setxattr(path, ".invalidate", b"1")
    except OSError: pass
    out(error="changed", message="The file changed in storage while it was read, so the read was stopped. Read it again.")
op, path = sys.argv[1], sys.argv[2]
if op == "read":
    try: f = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
    except OSError as e: fail(e)
    st = os.fstat(f)
    if stat.S_ISDIR(st.st_mode): out(error="isdir", message="Is a directory")
    if not stat.S_ISREG(st.st_mode): out(error="special", message="The path is a special file (a device, pipe or socket) and was refused.")
    if st.st_size > int(sys.argv[3]): out(error="large", size=st.st_size)
    if st.st_size > int(sys.argv[4]): out(size=st.st_size, inline=False)
    chunks = []
    while True:
        b = os.read(f, 65536)
        if not b: break
        chunks.append(b)
    data = b"".join(chunks)
    if len(data) < st.st_size: changed()
    out(size=len(data), inline=True, data=base64.b64encode(data).decode())
if op == "write":
    # A link is written through to its target, as a write in place would; the rename replaces the target.
    path = os.path.realpath(path)
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        try: old = os.stat(path)
        except FileNotFoundError: old = None
    except OSError as e: fail(e)
    if old is not None and stat.S_ISDIR(old.st_mode): out(error="isdir", message="Is a directory")
    if old is not None and not stat.S_ISREG(old.st_mode): out(error="special", message="The path is a special file (a device, pipe or socket) and was refused.")
    tmp = os.path.join(os.path.dirname(path), "." + os.path.basename(path) + ".agenta-" + sys.argv[5])
    try:
        f = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
        if old is not None: os.fchmod(f, stat.S_IMODE(old.st_mode))
        size = 0
        def put(b):
            global size
            v = memoryview(b)
            while v:
                n = os.write(f, v); v = v[n:]; size += n
        if sys.argv[3] == "-":
            put(base64.b64decode(sys.argv[4]))
        else:
            with open(sys.argv[3], "rb") as src:
                while True:
                    b = src.read(1 << 20)
                    if not b: break
                    put(b)
        os.fsync(f)
        os.close(f)
        os.replace(tmp, path)
    except OSError as e:
        try: os.unlink(tmp)
        except OSError: pass
        fail(e)
    finally:
        if sys.argv[3] != "-":
            try: os.unlink(sys.argv[3])
            except OSError: pass
    out(size=size)
if op == "ls":
    try: st = os.stat(path)
    except FileNotFoundError: out(type="missing")
    except OSError as e: fail(e)
    if not stat.S_ISDIR(st.st_mode): out(type="file")
    entries, cut = [], False
    try:
        with os.scandir(path) as it:
            for e in it:
                if len(entries) >= int(sys.argv[3]): cut = True; break
                try: entries.append([e.name, e.is_dir()])
                except OSError: pass
    except OSError as e: fail(e)
    out(type="dir", entries=entries, truncated=cut)
if op == "invalidate": changed()
out(error="op", message="unknown operation")
`;

export type SandboxFileErrorKind = "missing" | "isdir" | "notdir" | "denied" | "unmounted" | "special" | "large" | "changed" | "os" | "op";

/** How long the body of a large read's download may take; a stalled one fails instead of holding the tool. */
const DOWNLOAD_BODY_MS = 120_000;

/** A file operation the sandbox refused; `code` is Node's, so Pi words it as for a local file. */
export class SandboxFileError extends Error {
  readonly code: string | undefined;
  constructor(
    readonly kind: SandboxFileErrorKind,
    message: string,
  ) {
    const code = ({ missing: "ENOENT", isdir: "EISDIR", notdir: "ENOTDIR", denied: "EACCES" } as Record<string, string>)[kind];
    // Worded as Node words a local file error, which is what Pi's tools expect to show.
    super(code ? `${code}: ${message.toLowerCase()}` : message);
    this.name = "SandboxFileError";
    this.code = code;
  }
}

type Answer = Record<string, unknown> & { error?: SandboxFileErrorKind; message?: string };

async function helper(sandbox: DaytonaSandbox, args: string[], signal?: AbortSignal, timeoutSeconds = 60): Promise<Answer> {
  const r = await sandbox.run(`python3 -c ${shellQuote(HELPER)} ${args.map(shellQuote).join(" ")}`, { timeoutSeconds, ...(signal ? { signal } : {}) });
  const line = r.output.trim().split("\n").at(-1) ?? "";
  let answer: Answer;
  try {
    answer = JSON.parse(line) as Answer;
  } catch {
    throw new Error(`the command sandbox's file helper failed (exit ${r.exitCode}): ${r.output.slice(-160)}`);
  }
  if (answer.error && answer.error !== "large") throw new SandboxFileError(answer.error, String(answer.message ?? answer.error));
  return answer;
}

/** The whole file at `path`, refused over `maxBytes`. */
export async function readFile(sandbox: DaytonaSandbox, path: string, maxBytes: number, signal?: AbortSignal): Promise<Buffer> {
  const a = await helper(sandbox, ["read", path, String(maxBytes), String(INLINE_BYTES)], signal);
  if (a.error === "large") {
    const mb = (n: number) => `${Math.ceil(n / (1024 * 1024))} MB`;
    throw new Error(`The file is too large for file tools (${mb(Number(a.size))}; the limit is ${mb(maxBytes)}). Use a command instead.`);
  }
  if (a.inline) return Buffer.from(String(a.data ?? ""), "base64");
  const stream = await sandbox.download(path, signal);
  const stop = AbortSignal.any([AbortSignal.timeout(DOWNLOAD_BODY_MS), ...(signal ? [signal] : [])]);
  const onStop = () => stream.destroy(signal?.aborted ? new Error("aborted") : new Error("The file's download stalled, so the read was stopped. Read it again."));
  if (stop.aborted) onStop();
  stop.addEventListener("abort", onStop, { once: true });
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      size += (chunk as Buffer).length;
      if (size > maxBytes) {
        stream.destroy();
        throw new Error("The file grew past the file tool limit while it was read. Use a command instead.");
      }
      chunks.push(chunk as Buffer);
    }
  } finally {
    stop.removeEventListener("abort", onStop);
  }
  if (size < Number(a.size)) {
    await helper(sandbox, ["invalidate", path], signal).catch(() => {});
    throw new SandboxFileError("changed", "The file changed in storage while it was read, so the read was stopped. Read it again.");
  }
  return Buffer.concat(chunks);
}

/** Write `content` to `path`, creating its folders, and flush it to the store. Resolves with the size written. */
export async function writeFile(sandbox: DaytonaSandbox, path: string, content: Buffer, options: { tmpDir: string; signal?: AbortSignal }): Promise<number> {
  const id = randomUUID();
  if (content.length <= INLINE_BYTES) {
    return Number((await helper(sandbox, ["write", path, "-", content.toString("base64"), id], options.signal)).size);
  }
  const staged = `${options.tmpDir.replace(/\/+$/, "")}/.agenta-write-${id}`;
  await sandbox.upload(Readable.from([content]), staged, options.signal);
  return Number((await helper(sandbox, ["write", path, staged, "", id], options.signal, 300)).size);
}

export type Listing = { type: "missing" } | { type: "file" } | { type: "dir"; entries: Array<{ name: string; dir: boolean }>; truncated: boolean };

/** What `path` is, and a folder's entries. */
export async function list(sandbox: DaytonaSandbox, path: string, signal?: AbortSignal): Promise<Listing> {
  const a = await helper(sandbox, ["ls", path, String(LS_MAX_ENTRIES)], signal);
  if (a.type === "dir") return { type: "dir", entries: (a.entries as Array<[string, boolean]>).map(([name, dir]) => ({ name, dir })), truncated: !!a.truncated };
  return { type: a.type as "missing" | "file" };
}
