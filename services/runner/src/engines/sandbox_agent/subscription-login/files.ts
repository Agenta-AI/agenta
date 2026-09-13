/**
 * Where a hosted subscription login lives, and who is allowed to overwrite it.
 *
 * A hosted subscription run authenticates from a ChatGPT OAuth login the API delivers WITH the
 * request, written into the run's own agent dir before the harness starts. Pi then owns that file:
 * it refreshes its own token mid-turn and rewrites it in place.
 *
 * TWO INVARIANTS.
 *
 * NEVER DOWNGRADE. Writing a token older than what is on disk spends a refresh token the provider
 * has already rotated away, and the next run then has nothing to recover from. `decideSubscriptionWrite`
 * is the whole ordering rule.
 *
 * NEVER LOG THE CREDENTIAL. No token, no file content, no error body. The log vocabulary is a
 * decision word, a scope word, and a generation number.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import lockfile from "proper-lockfile";

import { observeSubscription } from "../../../subscription-events.ts";
import type {
  ModelConnectionSubscription,
  SubscriptionLogin,
} from "../../../protocol.ts";

type Log = (message: string) => void;

/** The provider id Pi keys its `auth.json` map by for a ChatGPT subscription. */
export const PI_SUBSCRIPTION_PROVIDER_ID = "openai-codex";

/** The login file inside a subscription agent dir. Pi's own name for it. */
export const SUBSCRIPTION_AUTH_FILE = "auth.json";

/**
 * The sidecar next to `auth.json` that records WHICH login lineage the file holds.
 *
 * `expires` alone cannot order two logins from different device sign-ins: a fresh sign-in can carry
 * a shorter life than a token an old session refreshed a minute ago. The sidecar carries the
 * `generation` the API stamps on every new sign-in, so the ordering is lineage first, expiry second.
 *
 * The runner writes it; Pi never does, and Pi's own refresh keeps the lineage. It holds two
 * integers and no credential.
 */
export const SUBSCRIPTION_META_FILE = "meta.json";

/** Pi's file mode for `auth.json`, applied on create and re-applied after every write. */
const AUTH_FILE_MODE = 0o600;

/** Pi's mode for the directory holding it. */
const AUTH_DIR_MODE = 0o700;

/**
 * What the user reads when the login could not be written before the harness started.
 *
 * One line, so `conciseError` surfaces it verbatim, and free of any word the run-error classifier
 * keys on: this is a runner-side write failure, not a provider refusal.
 */
export const SUBSCRIPTION_MATERIALIZE_FAILED_MESSAGE =
  "The ChatGPT sign-in could not be prepared for this run. Send the message again.";

function defaultLog(message: string): void {
  process.stderr.write(`[sandbox_agent/subscription-login] ${message}\n`);
}

/**
 * The `expires` of one login, or undefined when the value is not a usable timestamp.
 *
 * A missing or non-finite `expires` is NOT read as 0. Treating it as 0 would make every real login
 * look newer than a garbled one, so the garbled file would be silently overwritten.
 */
export function loginExpires(login: unknown): number | undefined {
  if (typeof login !== "object" || login === null) return undefined;
  const expires = (login as Record<string, unknown>).expires;
  return typeof expires === "number" && Number.isFinite(expires)
    ? expires
    : undefined;
}

/** The `openai-codex` entry of a parsed Pi `auth.json` map, when it holds one. */
export function subscriptionLoginFrom(
  raw: string | undefined,
): SubscriptionLogin | undefined {
  // `typeof` rather than `raw?.trim()`: the optional chain guards null and undefined and nothing
  // else, so a caller that handed over bytes would crash here instead of missing here.
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A half-written file (Pi writes in place, never temp-and-rename) is not readable state.
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const entry = (parsed as Record<string, unknown>)[PI_SUBSCRIPTION_PROVIDER_ID];
  if (typeof entry !== "object" || entry === null) return undefined;
  return entry as SubscriptionLogin;
}

/**
 * The text of an `auth.json` map holding `login` as its `openai-codex` entry.
 *
 * The merge keeps the whole map, like Pi's own read-modify-write: an entry for another provider in
 * the same file is preserved rather than dropped.
 */
function applySubscriptionLogin(
  current: string | undefined,
  login: SubscriptionLogin,
): string {
  let map: Record<string, unknown> = {};
  if (current?.trim()) {
    try {
      const parsed = JSON.parse(current) as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        map = parsed as Record<string, unknown>;
      }
    } catch {
      // Not a readable map, so there is nothing in it to preserve.
    }
  }
  map[PI_SUBSCRIPTION_PROVIDER_ID] = login;
  return JSON.stringify(map, null, 2);
}

/** What lineage the local `auth.json` belongs to. Written next to it, never inside it. */
export interface SubscriptionMeta {
  generation: number;
  version: number;
}

/** The sidecar's two integers, or undefined when the file is absent or unreadable. */
export function parseSubscriptionMeta(
  raw: string | undefined,
): SubscriptionMeta | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const record = parsed as Record<string, unknown>;
  const generation = record.generation;
  const version = record.version;
  if (typeof generation !== "number" || !Number.isFinite(generation)) {
    return undefined;
  }
  return {
    generation,
    version:
      typeof version === "number" && Number.isFinite(version) ? version : 0,
  };
}

function subscriptionMetaText(meta: SubscriptionMeta): string {
  return JSON.stringify({ generation: meta.generation, version: meta.version });
}

/** Why a materialize wrote, or why it did not. A log word and a test assertion, never user copy. */
export type SubscriptionWriteReason =
  | "invalid-delivered"
  | "no-local"
  | "newer-generation"
  | "older-generation"
  | "later-expiry"
  | "same-expiry-new-refresh"
  | "not-newer"
  | "changed-while-writing";

export interface SubscriptionWriteDecision {
  write: boolean;
  reason: SubscriptionWriteReason;
}

/**
 * Whether the delivered login replaces what is on disk. Pure, so the ordering rule is testable
 * without a filesystem or a sandbox.
 *
 * GENERATION FIRST, EXPIRY SECOND.
 *
 * - A NEWER generation always wins. The user signed in again, so every token of the old lineage is
 *   dead even with hours of nominal life left.
 * - An OLDER generation never wins. It belongs to a run that started before the new sign-in landed.
 * - SAME generation, or no sidecar: the later expiry wins, and an equal expiry with a DIFFERENT
 *   refresh token also wins. The provider rotates the refresh token on every exchange, so the
 *   delivered one is the copy the API can still hand to the next run.
 */
export function decideSubscriptionWrite(input: {
  local: SubscriptionLogin | undefined;
  meta: SubscriptionMeta | undefined;
  delivered: SubscriptionLogin;
  generation: number;
}): SubscriptionWriteDecision {
  const deliveredExpires = loginExpires(input.delivered);
  if (deliveredExpires === undefined) {
    return { write: false, reason: "invalid-delivered" };
  }
  if (!input.local) return { write: true, reason: "no-local" };

  const meta = input.meta;
  if (meta && meta.generation > input.generation) {
    return { write: false, reason: "older-generation" };
  }
  if (meta && meta.generation < input.generation) {
    return { write: true, reason: "newer-generation" };
  }

  const localExpires = loginExpires(input.local);
  if (localExpires === undefined) return { write: true, reason: "no-local" };
  if (deliveredExpires > localExpires) return { write: true, reason: "later-expiry" };
  if (
    deliveredExpires === localExpires &&
    input.local.refresh !== input.delivered.refresh
  ) {
    return { write: true, reason: "same-expiry-new-refresh" };
  }
  return { write: false, reason: "not-newer" };
}

/** The `auth.json` inside a subscription agent dir. */
export function subscriptionAuthPath(home: string): string {
  return join(home, SUBSCRIPTION_AUTH_FILE);
}

/** The lineage sidecar inside a subscription agent dir. */
export function subscriptionMetaPath(home: string): string {
  return join(home, SUBSCRIPTION_META_FILE);
}

export interface LocalSubscriptionFileDeps {
  /** Injected in tests so the lock itself can be asserted on without a real filesystem race. */
  lock?: typeof lockfile.lock;
}

/**
 * The sandbox file API surface this module needs. Typed structurally rather than against the
 * Daytona SDK so a test can pass two functions.
 */
export interface SubscriptionSandboxFs {
  mkdirFs: (input: { path: string }) => Promise<unknown>;
  writeFsFile: (input: { path: string }, content: string) => Promise<unknown>;
  /** BYTES, NOT TEXT. The sandbox file API answers with a buffer; `sandboxFileText` decodes it. */
  readFsFile?: (input: { path: string }) => Promise<unknown>;
  downloadFiles?: (input: { path: string }) => Promise<unknown>;
}

/**
 * Whatever the sandbox file API returned, as text. Undefined when it is not decodable.
 *
 * Anything other than a string, a Uint8Array, or an ArrayBuffer is treated as unreadable rather
 * than coerced: `String(buffer)` produces plausible garbage that would then be parsed as a login.
 */
export function sandboxFileText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  if (value instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(value));
  }
  return undefined;
}

/** Read one file out of a sandbox, or undefined when it is absent or unreadable. */
async function readSandboxFile(
  sandbox: SubscriptionSandboxFs,
  path: string,
): Promise<string | undefined> {
  try {
    if (typeof sandbox.readFsFile === "function") {
      return sandboxFileText(await sandbox.readFsFile({ path }));
    }
    if (typeof sandbox.downloadFiles === "function") {
      return sandboxFileText(await sandbox.downloadFiles({ path }));
    }
  } catch {
    // Absent, unreadable, or a sandbox that is already gone. All the same answer here.
  }
  return undefined;
}

/** What a mutation asks the file layer to persist, alongside whatever the caller wants back. */
export interface SubscriptionMutation<T> {
  result: T;
  /** The login to install. Absent leaves the file as it is. */
  login?: SubscriptionLogin;
  /** The lineage to stamp beside it. Absent keeps the sidecar, which is what a refresh wants. */
  meta?: SubscriptionMeta;
}

export interface SubscriptionMutationOutcome<T> {
  result: T;
  /** True when a requested write landed. False when none was asked for, or the file moved first. */
  wrote: boolean;
}

/**
 * Read this run's login, decide what to do with it, and persist the answer, as ONE operation.
 *
 * The callback may await: the recovery path exchanges the refresh token with the provider inside
 * it. That is why the whole sequence is one call rather than a read and a later write. Locally the
 * lock is held from the read to the write, so nothing can slip a newer login in between; on Daytona
 * there is no cross-sandbox lock, so the file is re-read and compared instead.
 */
export async function mutateSubscriptionLogin<T>(input: {
  home: string;
  isDaytona: boolean;
  sandbox?: SubscriptionSandboxFs;
  fileDeps?: LocalSubscriptionFileDeps;
  mutate: (
    current: SubscriptionLogin | undefined,
    meta: SubscriptionMeta | undefined,
  ) => SubscriptionMutation<T> | Promise<SubscriptionMutation<T>>;
}): Promise<SubscriptionMutationOutcome<T>> {
  if (input.isDaytona) {
    if (!input.sandbox) throw new Error("subscription run has no sandbox");
    return mutateDaytona(input.sandbox, input.home, input.mutate);
  }
  return mutateLocal(input.home, input.mutate, input.fileDeps ?? {});
}

/**
 * The local half, under Pi's own lock.
 *
 * `realpath: false` matches Pi (`FileAuthStorageBackend`): the lock name is derived from the path
 * as given, so both writers derive the same lock only while both use the same path. The directory
 * and an empty file are created first, exactly as Pi does, because `proper-lockfile` locks a path
 * that exists.
 *
 * A callback that outruns the lock's stale window is caught by `onCompromised`, which throws before
 * the write rather than letting two writers believe they both hold it.
 */
async function mutateLocal<T>(
  home: string,
  mutate: (
    current: SubscriptionLogin | undefined,
    meta: SubscriptionMeta | undefined,
  ) => SubscriptionMutation<T> | Promise<SubscriptionMutation<T>>,
  deps: LocalSubscriptionFileDeps,
): Promise<SubscriptionMutationOutcome<T>> {
  const authPath = subscriptionAuthPath(home);
  const metaPath = subscriptionMetaPath(home);
  const dir = dirname(authPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: AUTH_DIR_MODE });
  if (!existsSync(authPath)) {
    writeFileSync(authPath, "{}", { encoding: "utf-8", mode: AUTH_FILE_MODE });
    chmodSync(authPath, AUTH_FILE_MODE);
  }
  const acquire = deps.lock ?? lockfile.lock;
  let compromised: Error | undefined;
  const release = await acquire(authPath, {
    realpath: false,
    retries: {
      retries: 10,
      factor: 2,
      minTimeout: 100,
      maxTimeout: 10_000,
      randomize: true,
    },
    stale: 30_000,
    onCompromised: (err: Error) => {
      compromised = err;
    },
  });
  try {
    if (compromised) throw compromised;
    const currentRaw = existsSync(authPath)
      ? readFileSync(authPath, "utf-8")
      : undefined;
    // The sidecar is read under the SAME lock as the login it describes. Read outside it and a
    // concurrent materialize could pair one writer's lineage with the other writer's token.
    let currentMetaRaw: string | undefined;
    try {
      currentMetaRaw = existsSync(metaPath)
        ? readFileSync(metaPath, "utf-8")
        : undefined;
    } catch {
      // An unreadable sidecar is the same as none: fall back to the expiry-only rule.
    }
    const outcome = await mutate(
      subscriptionLoginFrom(currentRaw),
      parseSubscriptionMeta(currentMetaRaw),
    );
    if (compromised) throw compromised;
    if (!outcome.login) return { result: outcome.result, wrote: false };
    writeFileSync(authPath, applySubscriptionLogin(currentRaw, outcome.login), {
      encoding: "utf-8",
      mode: AUTH_FILE_MODE,
    });
    chmodSync(authPath, AUTH_FILE_MODE);
    // AFTER the login, and only when the login was written. A sidecar that ran ahead of its file
    // would claim a lineage the file does not hold.
    if (outcome.meta) {
      writeFileSync(metaPath, subscriptionMetaText(outcome.meta), {
        encoding: "utf-8",
        mode: AUTH_FILE_MODE,
      });
    }
    return { result: outcome.result, wrote: true };
  } finally {
    await release().catch(() => {});
  }
}

/**
 * The Daytona half.
 *
 * There is no cross-sandbox lock and none can be taken: the writers inside one sandbox are Pi
 * processes that DO share Pi's lock. What this guards against is a slow callback of our own — a
 * provider exchange — writing over a login that landed while it ran. So the file is re-read and
 * compared byte for byte, and a write is refused when it moved.
 */
async function mutateDaytona<T>(
  sandbox: SubscriptionSandboxFs,
  home: string,
  mutate: (
    current: SubscriptionLogin | undefined,
    meta: SubscriptionMeta | undefined,
  ) => SubscriptionMutation<T> | Promise<SubscriptionMutation<T>>,
): Promise<SubscriptionMutationOutcome<T>> {
  const authPath = `${home}/${SUBSCRIPTION_AUTH_FILE}`;
  const metaPath = `${home}/${SUBSCRIPTION_META_FILE}`;
  const authRaw = await readSandboxFile(sandbox, authPath);
  const metaRaw = await readSandboxFile(sandbox, metaPath);
  const outcome = await mutate(
    subscriptionLoginFrom(authRaw),
    parseSubscriptionMeta(metaRaw),
  );
  if (!outcome.login) return { result: outcome.result, wrote: false };
  const authNow = await readSandboxFile(sandbox, authPath);
  const metaNow = await readSandboxFile(sandbox, metaPath);
  if (authNow !== authRaw || metaNow !== metaRaw) {
    return { result: outcome.result, wrote: false };
  }
  await sandbox.mkdirFs({ path: home });
  await sandbox.writeFsFile(
    { path: authPath },
    applySubscriptionLogin(authRaw, outcome.login),
  );
  if (outcome.meta) {
    await sandbox.writeFsFile({ path: metaPath }, subscriptionMetaText(outcome.meta));
  }
  return { result: outcome.result, wrote: true };
}

/** The login on disk for this run, read through whichever filesystem holds it. */
export async function readSubscriptionLoginForRun(input: {
  home: string;
  isDaytona: boolean;
  sandbox?: SubscriptionSandboxFs;
  fileDeps?: LocalSubscriptionFileDeps;
}): Promise<SubscriptionLogin | undefined> {
  const outcome = await mutateSubscriptionLogin<SubscriptionLogin | undefined>({
    home: input.home,
    isDaytona: input.isDaytona,
    ...(input.sandbox ? { sandbox: input.sandbox } : {}),
    ...(input.fileDeps ? { fileDeps: input.fileDeps } : {}),
    mutate: (current) => ({ result: current }),
  });
  return outcome.result;
}

/**
 * Write the delivered login into this run's agent dir, unless what is on disk already wins by the
 * ordering above.
 */
export async function materializeSubscriptionLoginForRun(input: {
  home: string;
  isDaytona: boolean;
  sandbox?: SubscriptionSandboxFs;
  subscription: Pick<
    ModelConnectionSubscription,
    "id" | "login" | "version" | "generation"
  >;
  log?: Log;
  fileDeps?: LocalSubscriptionFileDeps;
}): Promise<SubscriptionWriteDecision> {
  const log = input.log ?? defaultLog;
  const { generation, version, login: delivered } = input.subscription;
  let localGeneration: number | undefined;
  const outcome = await mutateSubscriptionLogin<SubscriptionWriteDecision>({
    home: input.home,
    isDaytona: input.isDaytona,
    ...(input.sandbox ? { sandbox: input.sandbox } : {}),
    ...(input.fileDeps ? { fileDeps: input.fileDeps } : {}),
    mutate: (current, meta) => {
      localGeneration = meta?.generation;
      const decision = decideSubscriptionWrite({
        local: current,
        meta,
        delivered,
        generation,
      });
      return decision.write
        ? { result: decision, login: delivered, meta: { generation, version } }
        : { result: decision };
    },
  });
  const decision: SubscriptionWriteDecision =
    outcome.result.write && !outcome.wrote
      ? { write: false, reason: "changed-while-writing" }
      : outcome.result;
  observeSubscription(log, "subscription.materialize", {
    connection: input.subscription.id,
    scope: input.isDaytona ? "daytona" : "local",
    wrote: decision.write,
    reason: decision.reason,
    generation,
    localGeneration,
  });
  return decision;
}
