/**
 * The hosted subscription login: where it lands, how it is merged, and how a refresh gets home.
 *
 * A hosted subscription run authenticates from a ChatGPT OAuth login the API delivers WITH the
 * request (`modelConnection.subscription`), not from an operator mount on the runner box. This
 * module owns the three moments that touch that credential:
 *
 *  1. MATERIALIZE, before the harness starts: write `{"openai-codex": login}` into the run's own
 *     agent dir, under the same `proper-lockfile` lock Pi takes on that file.
 *  2. READ BACK, after every turn: Pi refreshes its own token mid-turn and writes the new one to
 *     the same file. That refresh is the only copy, so it has to reach the API before the dir goes.
 *  3. REPORT, when the harness says the login is dead: tell the API which version failed, and let
 *     it answer whether a newer login already exists.
 *
 * TWO RULES GOVERN EVERYTHING HERE.
 *
 * NEVER DOWNGRADE. The file on disk can be newer than the delivered login: a warm sandbox refreshed
 * it, or a concurrent session did. `expires` is the only ordering we have (absolute epoch millis,
 * the same field Pi compares), so a write happens only when the delivered login is strictly newer
 * than what is there. Writing an older token would spend a refresh token the provider has already
 * rotated away, and the next run would fail with nothing to recover from.
 *
 * NEVER LOG THE CREDENTIAL. No token, no file content, no `expires` value that could identify an
 * account, and no error body from the API. The log lines here carry a decision word and a status
 * code, and that is the whole vocabulary.
 */
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  watch as fsWatch,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import lockfile from "proper-lockfile";

import type { ModelConnectionSubscription, SubscriptionLogin } from "../../protocol.ts";

type Log = (message: string) => void;

/** The provider id Pi keys its `auth.json` map by for a ChatGPT subscription. */
export const PI_SUBSCRIPTION_PROVIDER_ID = "openai-codex";

/** The login file inside a subscription agent dir. Pi's own name for it. */
export const SUBSCRIPTION_AUTH_FILE = "auth.json";

/**
 * The sidecar next to `auth.json` that records WHICH login lineage the file holds.
 *
 * `expires` alone cannot order two logins from different device sign-ins: a fresh sign-in can
 * carry a SHORTER life than a token an old session refreshed a minute ago, and an expiry-only rule
 * would then keep the dead lineage and reject the live one. The sidecar carries the `generation`
 * the API stamps on every new sign-in, so the ordering is lineage first and expiry second
 * (contract amendment A4).
 *
 * The runner writes it; Pi never does. That is exactly right: Pi's own refresh keeps the lineage
 * and only moves the expiry, so a file the harness rewrote still matches its sidecar.
 *
 * It holds NO credential. Two integers, so a stray read of it discloses nothing.
 */
export const SUBSCRIPTION_META_FILE = "meta.json";

/** Pi's file mode for `auth.json`, applied on create and re-applied after every write. */
const AUTH_FILE_MODE = 0o600;

/** Pi's mode for the directory holding it. */
const AUTH_DIR_MODE = 0o700;

/** How long the runner waits on one push-back or failure report before giving up on it. */
const SUBSCRIPTION_API_TIMEOUT_MS = 10_000;

/**
 * What the user reads when the login could not be written before the harness started.
 *
 * One line, so `conciseError` surfaces it verbatim, and deliberately free of any word the run-error
 * classifier keys on — this is a runner-side write failure, not a provider refusal, and it must not
 * be re-read as a dead sign-in.
 */
export const SUBSCRIPTION_MATERIALIZE_FAILED_MESSAGE =
  "The ChatGPT sign-in could not be prepared for this run. Send the message again.";

function defaultLog(message: string): void {
  process.stderr.write(`[sandbox_agent/subscription-login] ${message}\n`);
}

/**
 * The `expires` of one login, or undefined when the value is not a usable timestamp.
 *
 * Deliberately strict: a missing, non-numeric, or non-finite `expires` is NOT read as 0. Treating
 * it as 0 would make every real login look newer than it, so a garbled file would be silently
 * overwritten — and the same rule running the other way would push a garbled login to the API.
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
  // `typeof` rather than `raw?.trim()`. The optional chain guards null and undefined and NOTHING
  // else, so a caller that handed over bytes crashed here instead of missing here. A crash on this
  // path costs a refreshed credential; see `SubscriptionSandboxFs.readFsFile`.
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
 * The text to write into `auth.json` so it holds the delivered login, or undefined when the file
 * already holds one at least as new.
 *
 * The merge is a read-modify-write of the WHOLE map, like Pi's own: an entry for another provider
 * in the same file is preserved rather than dropped. Only the `openai-codex` entry is replaced.
 */
export function mergeSubscriptionAuth(
  current: string | undefined,
  delivered: SubscriptionLogin,
): string | undefined {
  const deliveredExpires = loginExpires(delivered);
  if (deliveredExpires === undefined) return undefined;
  let map: Record<string, unknown> = {};
  if (current?.trim()) {
    try {
      const parsed = JSON.parse(current) as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        map = parsed as Record<string, unknown>;
      }
      // A file that does not parse, or parses to something other than a map, is replaced: it is
      // not a login we could be downgrading.
    } catch {
      // Same treatment as above.
    }
  }
  const existing = loginExpires(map[PI_SUBSCRIPTION_PROVIDER_ID]);
  if (existing !== undefined && existing >= deliveredExpires) return undefined;
  map[PI_SUBSCRIPTION_PROVIDER_ID] = delivered;
  return JSON.stringify(map, null, 2);
}

/**
 * The text of an `auth.json` map that holds `login` as its `openai-codex` entry, whatever was
 * there before. The unconditional half of {@link mergeSubscriptionAuth}: the caller has already
 * decided the write is right.
 */
export function applySubscriptionLogin(
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

/** The sidecar text for one delivered login. */
export function subscriptionMetaText(meta: SubscriptionMeta): string {
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
  | "not-newer";

/** The decision plus the exact bytes to persist when it says write. */
export interface SubscriptionWriteDecision {
  write: boolean;
  reason: SubscriptionWriteReason;
  auth?: string;
  meta?: string;
}

/**
 * Whether the delivered login replaces what is on disk, and with what bytes. Pure, so the whole
 * ordering rule is testable without a filesystem or a sandbox.
 *
 * GENERATION FIRST, EXPIRY SECOND (contract amendment A4).
 *
 * - A NEWER generation always wins, whatever the expiries say. The user signed in again, so every
 *   token of the old lineage is dead even if it has hours of nominal life left.
 * - An OLDER generation never wins. It is a run that started before the new sign-in landed;
 *   writing it would undo the sign-in the user just did.
 * - SAME generation (or no sidecar, which is the pre-A4 file this runner may still meet): the
 *   later expiry wins, and an equal expiry with a DIFFERENT refresh token also wins. Both of those
 *   are valid tokens of one lineage, and the provider rotates the refresh token on every exchange,
 *   so preferring the delivered one keeps the copy the API can still hand to the next run.
 *
 * NEVER DOWNGRADE remains the rule inside a generation: an older token would spend a refresh the
 * provider has already rotated away, and the next run would fail with nothing to recover from.
 */
export function decideSubscriptionWrite(input: {
  currentAuth: string | undefined;
  currentMeta: string | undefined;
  login: SubscriptionLogin;
  version: number;
  generation: number;
}): SubscriptionWriteDecision {
  const deliveredExpires = loginExpires(input.login);
  if (deliveredExpires === undefined) {
    return { write: false, reason: "invalid-delivered" };
  }
  const write = (reason: SubscriptionWriteReason): SubscriptionWriteDecision => ({
    write: true,
    reason,
    auth: applySubscriptionLogin(input.currentAuth, input.login),
    meta: subscriptionMetaText({
      generation: input.generation,
      version: input.version,
    }),
  });

  const local = subscriptionLoginFrom(input.currentAuth);
  if (!local) return write("no-local");

  const meta = parseSubscriptionMeta(input.currentMeta);
  if (meta && meta.generation > input.generation) {
    return { write: false, reason: "older-generation" };
  }
  if (meta && meta.generation < input.generation) {
    return write("newer-generation");
  }

  const localExpires = loginExpires(local);
  if (localExpires === undefined) return write("no-local");
  if (deliveredExpires > localExpires) return write("later-expiry");
  if (deliveredExpires === localExpires && local.refresh !== input.login.refresh) {
    return write("same-expiry-new-refresh");
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
 * Run `fn` against the current text of `<home>/auth.json` while holding Pi's own lock, and persist
 * whatever it returns.
 *
 * `realpath: false` matches Pi (`FileAuthStorageBackend`): the lock name is derived from the path
 * as given, so both writers derive the same lock only while both use the same path. The directory
 * and an empty file are created first, exactly as Pi does, because `proper-lockfile` locks a path
 * that exists.
 */
async function withLocalAuthLock<T>(
  home: string,
  fn: (
    current: string | undefined,
    currentMeta: string | undefined,
  ) => { result: T; next?: string; nextMeta?: string },
  deps: LocalSubscriptionFileDeps = {},
): Promise<T> {
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
    const current = existsSync(authPath)
      ? readFileSync(authPath, "utf-8")
      : undefined;
    // The sidecar is read under the SAME lock as the login it describes. Read outside it and a
    // concurrent materialize could pair one writer's lineage with the other writer's token.
    let currentMeta: string | undefined;
    try {
      currentMeta = existsSync(metaPath)
        ? readFileSync(metaPath, "utf-8")
        : undefined;
    } catch {
      // An unreadable sidecar is the same as none: fall back to the expiry-only rule.
    }
    const { result, next, nextMeta } = fn(current, currentMeta);
    if (compromised) throw compromised;
    if (next !== undefined) {
      writeFileSync(authPath, next, { encoding: "utf-8", mode: AUTH_FILE_MODE });
      chmodSync(authPath, AUTH_FILE_MODE);
      // AFTER the login, and only when the login was written. A sidecar that ran ahead of its
      // file would claim a lineage the file does not hold, and the next materialize would then
      // reject the very login that belongs there.
      if (nextMeta !== undefined) {
        writeFileSync(metaPath, nextMeta, {
          encoding: "utf-8",
          mode: AUTH_FILE_MODE,
        });
      }
    }
    return result;
  } finally {
    await release().catch(() => {});
  }
}

/**
 * Write the delivered login into the run's local agent dir, unless what is on disk already wins by
 * the A4 ordering. Reports whether it wrote.
 */
export async function materializeLocalSubscriptionLogin(
  home: string,
  subscription: Pick<
    ModelConnectionSubscription,
    "login" | "version" | "generation"
  >,
  log: Log = defaultLog,
  deps: LocalSubscriptionFileDeps = {},
): Promise<SubscriptionWriteDecision> {
  const decision = await withLocalAuthLock(
    home,
    (current, currentMeta) => {
      const result = decideSubscriptionWrite({
        currentAuth: current,
        currentMeta,
        login: subscription.login,
        version: subscription.version,
        generation: subscription.generation,
      });
      return { result, next: result.auth, nextMeta: result.meta };
    },
    deps,
  );
  log(
    `subscription login materialized=${decision.write} scope=local reason=${decision.reason}`,
  );
  return decision;
}

/** The login currently on local disk for this run, read under the same lock. */
export async function readLocalSubscriptionLogin(
  home: string,
  deps: LocalSubscriptionFileDeps = {},
): Promise<SubscriptionLogin | undefined> {
  return withLocalAuthLock(
    home,
    (current) => ({ result: subscriptionLoginFrom(current) }),
    deps,
  );
}

/**
 * The sandbox file API surface this module needs. Typed structurally rather than against the
 * Daytona SDK so a test can pass two functions.
 */
export interface SubscriptionSandboxFs {
  mkdirFs: (input: { path: string }) => Promise<unknown>;
  writeFsFile: (input: { path: string }, content: string) => Promise<unknown>;
  /**
   * BYTES, NOT TEXT. The sandbox file API answers with a buffer, and this declaration used to say
   * `Promise<string>` — a lie the compiler could not catch and the runtime paid for: every
   * Daytona read-back threw `raw?.trim is not a function`, so a token Pi refreshed inside a
   * sandbox never reached the API, and a warm sandbox that already held a login crashed its own
   * materialize. `unknown` is what forces the decode below, and it is what every other reader in
   * this runner already does (`usage.ts`, `pi-assets.ts`).
   */
  readFsFile?: (input: { path: string }) => Promise<unknown>;
  downloadFiles?: (input: { path: string }) => Promise<unknown>;
}

/**
 * Whatever the sandbox file API returned, as text. Undefined when it is not decodable.
 *
 * The shapes seen in practice are a Buffer, a Uint8Array, and a string; an ArrayBuffer is accepted
 * because a fetch-based transport can produce one. Anything else is treated as unreadable rather
 * than coerced, because `String(buffer)` and friends produce plausible garbage that would then be
 * parsed as a login.
 */
export function sandboxFileText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  if (value instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(value));
  }
  return undefined;
}

/** Read one file out of a sandbox, or undefined when it is absent or the API cannot read it. */
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

/**
 * Write the delivered login onto the sandbox's own in-VM disk, unless the file there already holds
 * one at least as new. A warm sandbox that refreshed the token keeps its file.
 *
 * There is no cross-process lock here and none is needed: the writers inside one sandbox are Pi
 * processes that DO share Pi's lock, and this call happens before any of them starts. Across
 * sandboxes the push-back and the API's `stale` answer decide the winner, not a lock.
 */
export async function materializeDaytonaSubscriptionLogin(
  sandbox: SubscriptionSandboxFs,
  home: string,
  subscription: Pick<
    ModelConnectionSubscription,
    "login" | "version" | "generation"
  >,
  log: Log = defaultLog,
): Promise<SubscriptionWriteDecision> {
  await sandbox.mkdirFs({ path: home });
  const authPath = `${home}/${SUBSCRIPTION_AUTH_FILE}`;
  const metaPath = `${home}/${SUBSCRIPTION_META_FILE}`;
  const decision = decideSubscriptionWrite({
    currentAuth: await readSandboxFile(sandbox, authPath),
    currentMeta: await readSandboxFile(sandbox, metaPath),
    login: subscription.login,
    version: subscription.version,
    generation: subscription.generation,
  });
  if (!decision.write) {
    log(
      `subscription login materialized=false scope=daytona reason=${decision.reason}`,
    );
    return decision;
  }
  await sandbox.writeFsFile({ path: authPath }, decision.auth as string);
  // Same order as the local path: the sidecar follows the file it describes.
  if (decision.meta !== undefined) {
    await sandbox.writeFsFile({ path: metaPath }, decision.meta);
  }
  log(
    `subscription login materialized=true scope=daytona reason=${decision.reason}`,
  );
  return decision;
}

/** The login currently on the sandbox's disk for this run. */
export async function readDaytonaSubscriptionLogin(
  sandbox: SubscriptionSandboxFs,
  home: string,
): Promise<SubscriptionLogin | undefined> {
  return subscriptionLoginFrom(
    await readSandboxFile(sandbox, `${home}/${SUBSCRIPTION_AUTH_FILE}`),
  );
}

/**
 * Replace the login on disk with `login`, unconditionally, keeping the lineage sidecar as it is.
 *
 * The ONE caller is the refresh-classification path (amendment A2): the runner exchanged the local
 * refresh token itself and holds the pair the provider just issued, so there is nothing to order
 * against — the file's own token is the one that was spent. Every other write goes through
 * `materializeLocalSubscriptionLogin`, which never downgrades.
 *
 * The lineage does NOT move. A refresh stays inside the generation it refreshed.
 */
export async function writeLocalSubscriptionLogin(
  home: string,
  login: SubscriptionLogin,
  deps: LocalSubscriptionFileDeps = {},
): Promise<void> {
  await withLocalAuthLock(
    home,
    (current) => ({
      result: undefined,
      next: applySubscriptionLogin(current, login),
    }),
    deps,
  );
}

/** The sandbox-side twin of {@link writeLocalSubscriptionLogin}. */
export async function writeDaytonaSubscriptionLogin(
  sandbox: SubscriptionSandboxFs,
  home: string,
  login: SubscriptionLogin,
): Promise<void> {
  const authPath = `${home}/${SUBSCRIPTION_AUTH_FILE}`;
  const current = await readSandboxFile(sandbox, authPath);
  await sandbox.writeFsFile({ path: authPath }, applySubscriptionLogin(current, login));
}

/** Where this run's login lives, read through whichever filesystem holds it. */
export async function readSubscriptionLoginForRun(input: {
  home: string;
  isDaytona: boolean;
  sandbox?: SubscriptionSandboxFs;
  fileDeps?: LocalSubscriptionFileDeps;
}): Promise<SubscriptionLogin | undefined> {
  if (input.isDaytona) {
    return input.sandbox
      ? readDaytonaSubscriptionLogin(input.sandbox, input.home)
      : undefined;
  }
  return readLocalSubscriptionLogin(input.home, input.fileDeps);
}

/** The write half of {@link readSubscriptionLoginForRun}. */
export async function writeSubscriptionLoginForRun(input: {
  home: string;
  isDaytona: boolean;
  sandbox?: SubscriptionSandboxFs;
  login: SubscriptionLogin;
  fileDeps?: LocalSubscriptionFileDeps;
}): Promise<void> {
  if (input.isDaytona) {
    if (input.sandbox) {
      await writeDaytonaSubscriptionLogin(input.sandbox, input.home, input.login);
    }
    return;
  }
  await writeLocalSubscriptionLogin(input.home, input.login, input.fileDeps);
}

/** Materialize into whichever filesystem this run's agent dir lives on. */
export async function materializeSubscriptionLoginForRun(input: {
  home: string;
  isDaytona: boolean;
  sandbox?: SubscriptionSandboxFs;
  subscription: Pick<
    ModelConnectionSubscription,
    "login" | "version" | "generation"
  >;
  log?: Log;
  fileDeps?: LocalSubscriptionFileDeps;
}): Promise<SubscriptionWriteDecision> {
  const log = input.log ?? defaultLog;
  if (input.isDaytona) {
    if (!input.sandbox) {
      return { write: false, reason: "not-newer" };
    }
    return materializeDaytonaSubscriptionLogin(
      input.sandbox,
      input.home,
      input.subscription,
      log,
    );
  }
  return materializeLocalSubscriptionLogin(
    input.home,
    input.subscription,
    log,
    input.fileDeps,
  );
}

/**
 * The OAuth claim that names the ChatGPT account a token was issued for. The provider's own
 * namespaced claim, read live off a real token on 2026-09-08.
 */
const OPENAI_AUTH_CLAIM = "https://api.openai.com/auth";

/** Why a login was refused for publication. A log word, never user copy. */
export type SubscriptionLoginRejection =
  | "access_missing"
  | "access_not_jwt"
  | "account_claim_missing"
  | "account_mismatch"
  | "refresh_missing"
  | "expires_invalid"
  | "expires_past";

/** The middle segment of a JWT as an object, or undefined when it is not one. */
function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return undefined;
  try {
    const parsed = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8"),
    ) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Is this login fit to publish to the API?
 *
 * WHY THIS EXISTS. The runner reads the login back off a file the harness owns, on disk the agent
 * itself can reach, and then hands it to the API as the project's stored credential. Every earlier
 * gate on that path asked only "is it NEWER" — `expires` is one number, and a corrupt or tampered
 * file can carry a later one while its tokens are garbage. Measured on 2026-09-08: a local
 * `auth.json` rewritten with junk `access` and `refresh` and a later `expires` was published and
 * OVERWROTE the good stored login, and the failure report that followed then looked current, so
 * the API answered `stale: false` and marked the connection `needs_login`. One bad file cost the
 * user their sign-in.
 *
 * So the runner proves the login is real before it publishes, and it proves it against the token
 * ITSELF rather than against anything the file claims alongside it. A ChatGPT access token is a
 * JWT whose `https://api.openai.com/auth` claim carries `chatgpt_account_id`; junk cannot forge
 * that, and a token belonging to a different account cannot pass the comparison.
 *
 * This is NOT authentication and does not try to be. The signature is not checked, because the
 * runner holds no key and the provider is the only authority on validity. It is a structural
 * check whose whole job is to keep garbage out of the vault. The API's own accountId check is the
 * backstop, not the substitute: by the time the API sees the push it has already been asked to
 * overwrite.
 *
 * A login that carries NO `accountId` is accepted when the claim is present. The field is optional
 * in the credential shape, the claim is what identifies the account, and rejecting on a missing
 * optional field would refuse a legitimate login.
 */
export function validateSubscriptionLogin(
  login: SubscriptionLogin | undefined,
  now: number = Date.now(),
): { ok: true } | { ok: false; reason: SubscriptionLoginRejection } {
  const reject = (
    reason: SubscriptionLoginRejection,
  ): { ok: false; reason: SubscriptionLoginRejection } => ({ ok: false, reason });
  if (!login || typeof login.access !== "string" || !login.access.trim()) {
    return reject("access_missing");
  }
  if (typeof login.refresh !== "string" || !login.refresh.trim()) {
    return reject("refresh_missing");
  }
  const expires = loginExpires(login);
  if (expires === undefined) return reject("expires_invalid");
  if (expires <= now) return reject("expires_past");

  const payload = decodeJwtPayload(login.access);
  if (!payload) return reject("access_not_jwt");
  const auth = payload[OPENAI_AUTH_CLAIM];
  const claimed =
    typeof auth === "object" && auth !== null
      ? (auth as Record<string, unknown>).chatgpt_account_id
      : undefined;
  if (typeof claimed !== "string" || !claimed) {
    return reject("account_claim_missing");
  }
  if (
    typeof login.accountId === "string" &&
    login.accountId &&
    login.accountId !== claimed
  ) {
    return reject("account_mismatch");
  }
  return { ok: true };
}

/**
 * The version a session has already pushed, per subscription id.
 *
 * Kept per environment rather than in a module map so two sessions on one runner cannot suppress
 * each other's push. `deliveredExpires` is the floor every comparison starts from; `pushedExpires`
 * moves up as pushes land, so the same refresh is never sent twice.
 */
export interface SubscriptionPushState {
  deliveredExpires: number | undefined;
  pushedExpires: number | undefined;
  /**
   * The version a PUSH quotes. It moves as pushes land, because a push is an update against the
   * version the API last confirmed; quoting a stale one would make the second push of a run fail.
   */
  version: number;
  /**
   * The lineage this session is running on. It rides every push and every failure report, because
   * the API cannot tell a stale VERSION (a refresh it already has) from a stale LINEAGE (a sign-in
   * that replaced this one) from the version alone. It moves only when a recovery adopts a newer
   * login the API handed back (contract amendment A4).
   */
  generation: number;
  /**
   * The version and generation this run was HANDED, which a failure report must quote and a push
   * must not.
   *
   * These exist because the two questions are different and one answer was being used for both.
   * A push says "update from what you last confirmed", so it follows the API. A failure report
   * asks "was the login I RAN ON already superseded?", and only the delivered value can ask that.
   * Measured on 2026-09-08: a push earlier in the run advanced the version, the failure report
   * afterwards quoted the new one, the API saw a current version and answered `stale: false`, and
   * a connection that had simply moved on was marked `needs_login`.
   *
   * They move only when a recovery ADOPTS a newer login (contract amendment A1), because the run
   * genuinely continues on that lineage from then on. A push never touches them.
   */
  deliveredVersion: number;
  deliveredGeneration: number;
}

export function subscriptionPushState(
  subscription: ModelConnectionSubscription,
): SubscriptionPushState {
  return {
    deliveredExpires: loginExpires(subscription.login),
    pushedExpires: undefined,
    version: subscription.version,
    generation: subscription.generation,
    deliveredVersion: subscription.version,
    deliveredGeneration: subscription.generation,
  };
}

/**
 * Whether a login read back off disk is worth pushing: it must be newer than the one delivered AND
 * newer than the last one this session pushed. Pure, so the rule is testable without a network.
 */
export function shouldPushSubscriptionLogin(
  state: SubscriptionPushState,
  login: SubscriptionLogin | undefined,
): boolean {
  const expires = loginExpires(login);
  if (expires === undefined) return false;
  if (state.deliveredExpires !== undefined && expires <= state.deliveredExpires) {
    return false;
  }
  if (state.pushedExpires !== undefined && expires <= state.pushedExpires) {
    return false;
  }
  return true;
}

export interface SubscriptionApiDeps {
  apiBase: string;
  authorization: string;
  fetchImpl?: typeof fetch;
  log?: Log;
}

/**
 * Push a refreshed login back to the API so the next run and every other session get it.
 *
 * NEVER FAILS THE TURN. A push that 404s, 401s, times out, or throws is logged as a status code
 * and dropped: the run already succeeded, and the harness still holds the working token in its own
 * process. The cost of a lost push is one extra refresh later, not a broken session.
 */
export async function pushSubscriptionLogin(
  subscription: ModelConnectionSubscription,
  state: SubscriptionPushState,
  login: SubscriptionLogin,
  deps: SubscriptionApiDeps,
): Promise<void> {
  const log = deps.log ?? defaultLog;
  const doFetch = deps.fetchImpl ?? fetch;
  // THE ONE GATE, and it is here rather than at each caller on purpose. Four paths publish — the
  // materialize-time self-heal, the watch or poll, the turn end, and the session end — and a fifth
  // will be added by someone who has not read this file. A check at the funnel cannot be forgotten.
  const verdict = validateSubscriptionLogin(login);
  if (!verdict.ok) {
    // The exact phrase the operator greps for, plus which check failed. Neither carries a token.
    log(
      `subscription login push skipped reason=unparseable check=${verdict.reason}`,
    );
    return;
  }
  const url = `${deps.apiBase}/secrets/${encodeURIComponent(subscription.id)}/subscription-login`;
  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: deps.authorization,
      },
      body: JSON.stringify({
        login,
        version: state.version,
        generation: state.generation,
      }),
      signal: AbortSignal.timeout(SUBSCRIPTION_API_TIMEOUT_MS),
    });
    if (!res.ok) {
      // The body can carry the API's own account/version detail; only the status is logged.
      log(`subscription login push failed status=${res.status}`);
      return;
    }
    // Record the push BEFORE reading the body: the API has it either way, and a body we cannot
    // parse must not make the next turn send the same login again.
    state.pushedExpires = loginExpires(login);
    const body = (await res.json().catch(() => ({}))) as {
      version?: unknown;
      updated?: unknown;
      stale?: unknown;
      reason?: unknown;
    };
    if (typeof body.version === "number") state.version = body.version;
    if (body.updated === false) {
      // The API kept its own login: an older generation, an older expiry, the same token, or a
      // token that failed its shape check. Say which, so a refused push is visible in the log.
      log(
        `subscription login push refused version=${state.version} stale=${body.stale === true}` +
          (typeof body.reason === "string" ? ` reason=${body.reason}` : ""),
      );
      return;
    }
    log(`subscription login push ok version=${state.version}`);
  } catch (err) {
    log(`subscription login push failed ${describeThrown(err)}`);
  }
}

/**
 * Read the run's login back and push it when it moved. The one entry point the turn path calls.
 */
export async function pushBackSubscriptionLogin(input: {
  subscription: ModelConnectionSubscription;
  state: SubscriptionPushState;
  home: string;
  sandbox?: SubscriptionSandboxFs;
  isDaytona: boolean;
  api: SubscriptionApiDeps;
  fileDeps?: LocalSubscriptionFileDeps;
  /** Which of the publish moments this is, so the log says WHICH one decided what. */
  moment?: string;
}): Promise<void> {
  const log = input.api.log ?? defaultLog;
  const moment = input.moment ?? "unknown";
  try {
    const login = input.isDaytona
      ? input.sandbox
        ? await readDaytonaSubscriptionLogin(input.sandbox, input.home)
        : undefined
      : await readLocalSubscriptionLogin(input.home, input.fileDeps);
    if (!shouldPushSubscriptionLogin(input.state, login)) {
      // EVERY NO-PUSH OUTCOME SAYS SO, WITH THE NUMBERS THAT DECIDED IT.
      //
      // This used to return in silence, and the silence cost a whole debugging round: a live cell
      // showed Pi refreshing and nothing being published, and the log could not distinguish "the
      // file had not been rewritten yet" from "the read found nothing" from "the floor was already
      // above it" from "this path never ran". Five outcomes, one absence of evidence.
      //
      // The three values are epoch milliseconds. A token's expiry is not a credential and cannot
      // identify an account; it is the only thing that makes this decision reproducible.
      log(
        `subscription login read-back skip moment=${moment} ` +
          `disk=${loginExpires(login) ?? "none"} ` +
          `delivered=${input.state.deliveredExpires ?? "none"} ` +
          `pushed=${input.state.pushedExpires ?? "none"}`,
      );
      return;
    }
    await pushSubscriptionLogin(
      input.subscription,
      input.state,
      login as SubscriptionLogin,
      input.api,
    );
  } catch (err) {
    log(
      `subscription login read-back failed moment=${moment} ${describeThrown(err)}`,
    );
  }
}

/**
 * Tell the API that this run's login was refused, and ask whether a newer one exists.
 *
 * `stale: true` means the stored login moved on while this run held an old one, which is a retry,
 * not a re-login. Anything else — including a call that fails outright — is treated as "the login
 * is dead", because that is the safe direction: offering a sign-in the user does not need costs a
 * click, while offering a retry against a dead login loops forever.
 */
export interface SubscriptionFailureReport {
  stale: boolean;
  /**
   * The login the API holds instead, present only on a stale answer. It is the whole point of the
   * report under amendment A1: the runner rematerializes THIS login and retries, rather than
   * telling the user to sign in again for a connection that is already fine.
   */
  login?: SubscriptionLogin;
  version?: number;
  generation?: number;
}

export async function reportSubscriptionLoginFailure(
  subscription: ModelConnectionSubscription,
  state: SubscriptionPushState,
  reason: string,
  deps: SubscriptionApiDeps,
): Promise<SubscriptionFailureReport> {
  const log = deps.log ?? defaultLog;
  const doFetch = deps.fetchImpl ?? fetch;
  const url = `${deps.apiBase}/secrets/${encodeURIComponent(subscription.id)}/subscription-login/failure`;
  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: deps.authorization,
      },
      // DELIVERED, never the value a push in this same run learned. See `deliveredVersion`.
      body: JSON.stringify({
        version: state.deliveredVersion,
        generation: state.deliveredGeneration,
        reason,
      }),
      signal: AbortSignal.timeout(SUBSCRIPTION_API_TIMEOUT_MS),
    });
    if (!res.ok) {
      log(`subscription login failure report status=${res.status}`);
      return { stale: false };
    }
    const body = (await res.json().catch(() => ({}))) as {
      stale?: unknown;
      login?: unknown;
      version?: unknown;
      generation?: unknown;
    };
    const stale = body.stale === true;
    const report: SubscriptionFailureReport = { stale };
    // Only from a STALE answer. A non-stale body has no newer login to offer, and adopting
    // anything it did carry would overwrite the file with the credential we just proved dead.
    if (stale && loginExpires(body.login) !== undefined) {
      report.login = body.login as SubscriptionLogin;
    }
    if (typeof body.version === "number") report.version = body.version;
    if (typeof body.generation === "number") {
      report.generation = body.generation;
    }
    log(
      `subscription login failure report ok stale=${stale} recovered=${report.login !== undefined}`,
    );
    return report;
  } catch (err) {
    log(`subscription login failure report failed ${describeThrown(err)}`);
    return { stale: false };
  }
}

/**
 * The push-back a turn and a teardown both call: read this run's login back and send it if it
 * moved. A no-op for every run that carries no subscription, and for a Daytona run whose sandbox
 * is already gone.
 *
 * It never throws and never rejects. The caller is a `finally` block on the turn path; a failed
 * push must not turn a finished turn into a failed one.
 */
export async function pushBackSubscriptionLoginForRun(input: {
  plan: {
    isDaytona: boolean;
    credentials: {
      subscription?: ModelConnectionSubscription;
      subscriptionHome?: string;
    };
  };
  state: SubscriptionPushState | undefined;
  sandbox: unknown;
  apiBase: string;
  authorization: string;
  /** Test seam, matching `SubscriptionApiDeps`; production passes nothing and uses global fetch. */
  fetchImpl?: typeof fetch;
  log?: Log;
  /** Which publish moment this is: `materialize`, `turn-end`, `session-end`. */
  moment?: string;
}): Promise<void> {
  const log = input.log ?? defaultLog;
  const moment = input.moment ?? "unknown";
  const subscription = input.plan.credentials.subscription;
  const home = input.plan.credentials.subscriptionHome;
  // A run with no subscription is not interesting and must not fill the log.
  if (!subscription) return;
  // These three ARE interesting: the run carries a subscription, so a missing home, a missing
  // push state, or a missing credential is a wiring fault, and it used to be invisible.
  if (!home || !input.state) {
    log(
      `subscription login read-back skip moment=${moment} reason=not-wired ` +
        `home=${home ? "yes" : "no"} state=${input.state ? "yes" : "no"}`,
    );
    return;
  }
  if (!input.authorization) {
    // Without a credential the API would refuse the push anyway; say so rather than vanish.
    log(`subscription login read-back skip moment=${moment} reason=no-credential`);
    return;
  }
  await pushBackSubscriptionLogin({
    subscription,
    state: input.state,
    home,
    sandbox: input.sandbox as SubscriptionSandboxFs | undefined,
    isDaytona: input.plan.isDaytona,
    moment,
    api: {
      apiBase: input.apiBase,
      authorization: input.authorization,
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
      log: input.log,
    },
  });
}

/**
 * A running publisher. `stop` is idempotent and never throws.
 */
export interface SubscriptionLoginWatch {
  stop: () => void;
}

/** Local default: how long after the last write the runner reads the file back. */
export const LOCAL_WATCH_DEBOUNCE_MS = 500;

/**
 * How often the FALLBACK watcher stats `auth.json` when `fs.watch` is unavailable.
 *
 * `fs.watch` is an inotify instance, and `fs.inotify.max_user_instances` is a per-UID kernel
 * limit (128 by default) shared by every process running as that uid ON THE WHOLE HOST — every
 * container included, because a container's root IS the host's root unless user namespaces are
 * remapped. A busy box therefore denies the runner a watcher through no fault of its own:
 * measured on this dev box on 2026-09-08, uid 0 could not open a single watch while uid 1000
 * could, with 69 root containers running.
 *
 * Five seconds is the interval the runner track was asked for, and the trade is the right way
 * round: the cost is one read of a 2 KB file every five seconds per active subscription turn, and
 * the benefit is that the publish window for a refreshed credential stays a handful of seconds
 * instead of a whole turn. Inotify is faster; the gap between them does not matter next to the
 * gap between either of them and losing the token.
 */
export const LOCAL_WATCH_POLL_INTERVAL_MS = 5_000;

/** An OS error, reduced to the two fields worth logging. Never the file's content. */
function describeFsError(err: unknown): string {
  if (!(err instanceof Error)) return "error=unknown";
  const code = (err as NodeJS.ErrnoException).code;
  // The message can name the watched PATH, which is fine — it is a directory the runner chose,
  // and it holds no credential itself. It never carries the file's content.
  return `error=${err.name} code=${code ?? "none"} message=${JSON.stringify(err.message)}`;
}

/**
 * A thrown value, reduced to the three things that let someone FIX it: the class, the message, and
 * the first stack frame.
 *
 * `error=TypeError` on its own is what a bare `err.name` gives, and it is almost worthless: it
 * says a defect exists without saying where. That exact line appeared on three live turns before
 * anyone could act on it. The first frame is the file, line, and column inside this runner, which
 * is the whole diagnosis in one token.
 *
 * NEVER THE FILE'S CONTENT. A message and a stack frame are runner-authored strings; the login is
 * never interpolated into either. A path may appear and is fine — it names a directory the runner
 * chose, not a credential.
 */
function describeThrown(err: unknown): string {
  if (!(err instanceof Error)) {
    return `error=unknown value=${JSON.stringify(String(err)).slice(0, 120)}`;
  }
  const frame = (err.stack ?? "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("at "));
  return `error=${err.name} message=${JSON.stringify(err.message)} at=${JSON.stringify(frame ?? "none")}`;
}

/** Daytona default: how often the runner reads the in-VM file through the sandbox API. */
export const DAYTONA_POLL_INTERVAL_MS = 30_000;

/**
 * Publish a refreshed login AT REFRESH TIME, not only at the end of the turn (amendment A3).
 *
 * WHY THIS EXISTS. Pi refreshes its own OAuth token in the middle of a turn and writes the new
 * pair into `auth.json`. That written file is the ONLY copy: the delivered refresh token has been
 * spent, and the provider rotated it away. A turn that runs for an hour and is then killed — a
 * sandbox eviction, a runner restart, a crash — takes the only live credential with it, and the
 * next run starts from a token the provider will refuse. Publishing on the write itself shrinks
 * that window from a whole turn to the debounce interval.
 *
 * LOCAL uses `fs.watch` on the agent DIR, not on the file. A directory watch survives a writer
 * that replaces the file rather than rewriting it, and it still fires for Pi's in-place write.
 * Events are debounced because one logical write raises several of them.
 *
 * The read goes through the same lock as every other read here, so a half-written file is never
 * pushed.
 */
export function watchLocalSubscriptionLogin(input: {
  home: string;
  onLogin: (login: SubscriptionLogin) => void | Promise<void>;
  debounceMs?: number;
  log?: Log;
  fileDeps?: LocalSubscriptionFileDeps;
  watchImpl?: typeof fsWatch;
  pollIntervalMs?: number;
}): SubscriptionLoginWatch {
  const log = input.log ?? defaultLog;
  const debounceMs = input.debounceMs ?? LOCAL_WATCH_DEBOUNCE_MS;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reading = false;

  const read = async (): Promise<void> => {
    // One read at a time. A burst of writes must not open a second lock acquisition that then
    // queues behind the first for the whole retry budget.
    if (stopped || reading) return;
    reading = true;
    try {
      const login = await readLocalSubscriptionLogin(input.home, input.fileDeps);
      if (login && !stopped) await input.onLogin(login);
    } catch (err) {
      log(`subscription login watch read failed ${describeThrown(err)}`);
    } finally {
      reading = false;
    }
  };

  const schedule = (): void => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void read();
    }, debounceMs);
    timer.unref?.();
  };

  /**
   * The fallback: read the login file on an interval and schedule a publish when it changes.
   *
   * Started only when `fs.watch` is unavailable, and it is a REPLACEMENT rather than a degradation
   * to nothing. Losing the early publish means a refresh Pi wrote mid-turn survives only where it
   * was written, and a turn that then dies takes the only live credential with it — the exact loss
   * amendment A3 exists to prevent.
   *
   * THE CHANGE SIGNAL IS A CONTENT HASH, NOT `stat`. A stat-based poller looked obviously right
   * and was measurably wrong: on this box two writes inside one event-loop tick produced an
   * IDENTICAL `mtimeNs` and an identical `size`, so the second was invisible. That is not a corner
   * case for this file. The provider rotates the refresh token to a string of the same length, so
   * a materialize followed closely by Pi's own refresh writes two payloads that differ only in
   * their bytes — precisely what `stat` cannot see. Hashing 2 KB once a second costs nothing next
   * to losing the only copy of a live credential.
   *
   * The bytes are hashed and dropped. They are never logged, and the value that gets published is
   * re-read under Pi's lock by `read()`, so a half-written file cannot be pushed.
   */
  let poller: ReturnType<typeof setInterval> | undefined;
  const startPolling = (): void => {
    if (stopped || poller) return;
    const authPath = subscriptionAuthPath(input.home);
    const signature = (): string => {
      try {
        // `size` and `mtimeMs` ride along so a hash collision is not the only thing standing
        // between a refreshed credential and the API.
        const stat = statSync(authPath);
        return `${createHash("sha256")
          .update(readFileSync(authPath))
          .digest("hex")}:${stat.size}:${stat.mtimeMs}`;
      } catch {
        return "";
      }
    };
    let last = signature();
    poller = setInterval(() => {
      if (stopped) return;
      const next = signature();
      if (next === last || next === "") return;
      last = next;
      schedule();
    }, input.pollIntervalMs ?? LOCAL_WATCH_POLL_INTERVAL_MS);
    poller.unref?.();
    log("subscription login watch mode=poll");
  };

  let watcher: ReturnType<typeof fsWatch> | undefined;
  try {
    const watch = input.watchImpl ?? fsWatch;
    watcher = watch(input.home, (_event, filename) => {
      // A directory watch reports every child. Only the login file is interesting, and a null
      // filename (some platforms report none) is treated as "might be it".
      if (filename && filename.toString() !== SUBSCRIPTION_AUTH_FILE) return;
      schedule();
    });
    watcher.on?.("error", (err: unknown) => {
      // A watch can die long after it started, and the credential still has to reach the API.
      // Hand over to the poller rather than going silent for the rest of the turn.
      log(`subscription login watch stopped ${describeFsError(err)}`);
      try {
        watcher?.close();
      } catch {
        // Already gone; the handover below is what matters.
      }
      watcher = undefined;
      startPolling();
    });
    watcher.unref?.();
  } catch (err) {
    // The common cause is EMFILE from the per-UID `fs.inotify.max_user_instances` limit, which
    // says nothing about this runner and everything about what else runs as the same uid. The
    // code and the message go in the log so the next reader does not have to rediscover that.
    log(`subscription login watch unavailable ${describeFsError(err)}`);
    startPolling();
  }

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      if (poller) clearInterval(poller);
      poller = undefined;
      try {
        watcher?.close();
      } catch {
        // Already closed.
      }
    },
  };
}

/**
 * The Daytona half of amendment A3: there is no `fs.watch` across the sandbox boundary, so the
 * runner reads the in-VM file through the sandbox file API on an interval while a turn runs.
 *
 * The interval is 30 s by default, which is the contract's number: it is short next to a turn and
 * long next to the file API's cost, and the turn-end read still backstops it.
 */
export function pollDaytonaSubscriptionLogin(input: {
  sandbox: SubscriptionSandboxFs;
  home: string;
  onLogin: (login: SubscriptionLogin) => void | Promise<void>;
  intervalMs?: number;
  log?: Log;
}): SubscriptionLoginWatch {
  const log = input.log ?? defaultLog;
  let stopped = false;
  let reading = false;
  const timer = setInterval(
    () => {
      if (stopped || reading) return;
      reading = true;
      void (async () => {
        try {
          const login = await readDaytonaSubscriptionLogin(
            input.sandbox,
            input.home,
          );
          if (login && !stopped) await input.onLogin(login);
        } catch (err) {
          log(`subscription login poll failed ${describeThrown(err)}`);
        } finally {
          reading = false;
        }
      })();
    },
    input.intervalMs ?? DAYTONA_POLL_INTERVAL_MS,
  );
  timer.unref?.();
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}

/** A watch that does nothing, for every run that carries no subscription. */
const NO_WATCH: SubscriptionLoginWatch = { stop: () => {} };

/**
 * Start publishing this run's refreshed login as soon as it is written, on whichever filesystem
 * holds it. A no-op for a run with no subscription and for a Daytona run with no sandbox.
 *
 * The caller owns `stop` and must call it on every exit path.
 */
export function startSubscriptionLoginPublisher(input: {
  plan: {
    isDaytona: boolean;
    credentials: {
      subscription?: ModelConnectionSubscription;
      subscriptionHome?: string;
    };
  };
  state: SubscriptionPushState | undefined;
  sandbox: unknown;
  apiBase: string;
  authorization: string;
  fetchImpl?: typeof fetch;
  log?: Log;
  debounceMs?: number;
  intervalMs?: number;
  pollIntervalMs?: number;
  watchImpl?: typeof fsWatch;
  fileDeps?: LocalSubscriptionFileDeps;
}): SubscriptionLoginWatch {
  const subscription = input.plan.credentials.subscription;
  const home = input.plan.credentials.subscriptionHome;
  const state = input.state;
  if (!subscription || !home || !state || !input.authorization) return NO_WATCH;
  const api: SubscriptionApiDeps = {
    apiBase: input.apiBase,
    authorization: input.authorization,
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    log: input.log,
  };
  const onLogin = async (login: SubscriptionLogin): Promise<void> => {
    // The same floor the turn-end push uses, so a watch and a turn end never send the same login
    // twice and neither can send one older than what the API already holds.
    if (!shouldPushSubscriptionLogin(state, login)) return;
    await pushSubscriptionLogin(subscription, state, login, api);
  };
  if (input.plan.isDaytona) {
    const sandbox = input.sandbox as SubscriptionSandboxFs | undefined;
    if (!sandbox) return NO_WATCH;
    return pollDaytonaSubscriptionLogin({
      sandbox,
      home,
      onLogin,
      ...(input.intervalMs !== undefined ? { intervalMs: input.intervalMs } : {}),
      log: input.log,
    });
  }
  return watchLocalSubscriptionLogin({
    home,
    onLogin,
    ...(input.debounceMs !== undefined ? { debounceMs: input.debounceMs } : {}),
    ...(input.pollIntervalMs !== undefined
      ? { pollIntervalMs: input.pollIntervalMs }
      : {}),
    log: input.log,
    ...(input.fileDeps ? { fileDeps: input.fileDeps } : {}),
    ...(input.watchImpl ? { watchImpl: input.watchImpl } : {}),
  });
}
