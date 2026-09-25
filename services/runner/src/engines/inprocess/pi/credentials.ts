/**
 * Model credentials for in-process Pi sessions.
 *
 * Invariants:
 * - No provider key is read from, or written to, `process.env`. Keys come from the run's own model
 *   environment and are set on the session's own runtime. The runner refuses to start with
 *   provider keys in its environment (`providerKeysInEnvironment`), because Pi falls back to them.
 * - A managed run holds its keys as runtime keys on the session; its store is pi-ai's in-memory one.
 * - A subscription login lives in its connection's login file, and every read and write of it goes
 *   through the one locked, lineage-aware writer the rest of the runner uses
 *   (`subscription-login/files.ts`). A refresh here, a refresh by a local Pi subprocess on the same
 *   connection, and a login the API delivers are serialized by the same lock, and a refresh keeps
 *   the lineage sidecar, so it can never overwrite a newer sign-in.
 */
import { InMemoryCredentialStore, type AuthOperationOptions, type Credential, type CredentialInfo, type CredentialStore } from "pi-coding-agent-pi-ai";
import { findEnvKeys, getProviders } from "pi-coding-agent-pi-ai/compat";
import type { SubscriptionLogin } from "../../../protocol.ts";
import {
  mutateSubscriptionLogin,
  PI_SUBSCRIPTION_PROVIDER_ID,
  readSubscriptionLoginForRun,
} from "../../sandbox_agent/subscription-login/files.ts";
import { untilAborted } from "../sandbox/serial-queue.ts";

/**
 * Ambient credentials pi-ai picks up without a provider key variable (AWS task roles, Google
 * application default credentials). Any of them on the runner would be shared by every session.
 */
export const AMBIENT_CREDENTIAL_ENV = [
  "AWS_PROFILE",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_BEARER_TOKEN_BEDROCK",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
  "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  "AWS_WEB_IDENTITY_TOKEN_FILE",
  "GOOGLE_APPLICATION_CREDENTIALS",
];

/** Env var names that would hand every in-process session a credential, by pi-ai's own table. */
export function providerKeysInEnvironment(env: Record<string, string | undefined>): string[] {
  const defined: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) if (value) defined[name] = value;
  const found = new Set<string>();
  for (const provider of getProviders()) {
    for (const name of findEnvKeys(provider, defined) ?? []) if (defined[name]) found.add(name);
  }
  for (const name of AMBIENT_CREDENTIAL_ENV) if (env[name]) found.add(name);
  return [...found].sort();
}

/** Provider id -> key, taken only from the run's own model environment, named by pi-ai's table. */
export function apiKeysFromModelEnvironment(
  modelEnv: Record<string, string>,
  providerIds: readonly string[],
): Map<string, string> {
  const keys = new Map<string, string>();
  for (const id of providerIds) {
    // ANTHROPIC_AUTH_TOKEN is a bearer header, not an API key; pi-ai skips it the same way.
    const name = (findEnvKeys(id, modelEnv) ?? []).find((n) => !!modelEnv[n] && n !== "ANTHROPIC_AUTH_TOKEN");
    if (name) keys.set(id, modelEnv[name]!);
  }
  return keys;
}

function toCredential(login: SubscriptionLogin | undefined): Credential | undefined {
  if (!login || login.type !== "oauth") return undefined;
  return { ...login, type: "oauth" };
}

function toLogin(credential: Credential): SubscriptionLogin | undefined {
  if (credential.type !== "oauth") return undefined;
  return { ...credential };
}

export const SUBSCRIPTION_OPERATION_TIMEOUT_MS = 60_000;

/**
 * A hosted subscription run: the connection's login file, read and refreshed under the shared lock.
 * Only the subscription provider lives there; any other provider is answered from memory.
 */
export class SubscriptionCredentialStore implements CredentialStore {
  private readonly others = new InMemoryCredentialStore();

  constructor(
    /** The connection's login directory (the run's `PI_CODING_AGENT_DIR`). */
    private readonly home: string,
    private readonly timeoutMs = SUBSCRIPTION_OPERATION_TIMEOUT_MS,
  ) {}

  private deadline(options?: AuthOperationOptions): AbortSignal {
    return options?.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs);
  }

  /** Stop waiting at the deadline or on Stop; the work itself runs to its end. */
  private bounded<T>(work: Promise<T>, options?: AuthOperationOptions): Promise<T> {
    return untilAborted(work, this.deadline(options));
  }

  async read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
    if (providerId !== PI_SUBSCRIPTION_PROVIDER_ID) return this.others.read(providerId);
    return toCredential(await this.bounded(readSubscriptionLoginForRun({ home: this.home, isDaytona: false }), options));
  }

  async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
    const login = await this.read(PI_SUBSCRIPTION_PROVIDER_ID, options);
    return [...(login ? [{ providerId: PI_SUBSCRIPTION_PROVIDER_ID, type: login.type }] : []), ...(await this.others.list())];
  }

  /**
   * The refresh runs inside the lock with the login read under it, so a second session that
   * waited finds the fresh token and pi-ai returns "no change". The sidecar is left as it is: a
   * refresh continues the lineage it started from.
   */
  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
    if (providerId !== PI_SUBSCRIPTION_PROVIDER_ID) return this.others.modify(providerId, fn);
    // On timeout or Stop this call stops waiting; the refresh finishes under its lock in the
    // background and is written as usual, so a rotated refresh token is never lost.
    const outcome = await this.bounded(
      mutateSubscriptionLogin<Credential | undefined>({
        home: this.home,
        isDaytona: false,
        mutate: async (currentLogin) => {
          const current = toCredential(currentLogin);
          const next = await fn(current);
          const login = next ? toLogin(next) : undefined;
          return login ? { result: next, login } : { result: current };
        },
      }),
      options,
    );
    return outcome.result;
  }

  /** The API decides which login is current; the runner never deletes one. */
  async delete(providerId: string): Promise<void> {
    if (providerId !== PI_SUBSCRIPTION_PROVIDER_ID) await this.others.delete(providerId);
  }
}
