/**
 * Session keep-alive pool: normal turn boundaries, local sandbox, enabled by default.
 *
 * At a normal turn boundary, keep-alive parks the live session for a short TTL so the next
 * message in the same conversation continues the same harness process and native memory. If the
 * window expires, the operator disables keep-alive, or any fingerprint mismatches, dispatch falls
 * back to the cold path.
 *
 * This module is engine-agnostic: it holds opaque `environment` handles plus the metadata the
 * dispatch needs to decide continue-versus-cold (two fingerprints, a credential epoch, an LRU
 * timestamp, a state) and a complete idempotent `teardown(reason)` closure the engine supplies. It
 * never imports the engine, so it stays a pure map + timer + policy unit. Operators can disable
 * it explicitly with `AGENTA_RUNNER_SESSION_KEEPALIVE=off`.
 */
import type { CredentialEpoch, KeepaliveConfig } from "./session-identity.ts";
import type { TeardownReason } from "./teardown.ts";

function log(message: string): void {
  process.stderr.write(`[keepalive] ${message}\n`);
}

// --- The pool --------------------------------------------------------------- //

export type SessionState = "busy" | "idle" | "awaiting_approval" | "destroyed";

/**
 * One parked live session. `environment` is opaque to the pool (the engine reads it on a
 * continuation). `teardown` is the engine's complete, idempotent teardown closure.
 */
export interface LiveSession<E = unknown> {
  key: string;
  environment: E;
  configFingerprint: string;
  historyFingerprint: string;
  credentialEpoch: CredentialEpoch;
  state: SessionState;
  lastUsed: number;
  teardown: (reason: TeardownReason) => Promise<void>;
  /** Internal: the idle/approval TTL timer. */
  ttlTimer?: ReturnType<typeof setTimeout>;
  /** Internal: the one teardown whose resolution confirms strict-capacity seat release. */
  teardownPromise?: Promise<void>;
}

/** Fields the caller supplies to park a session (the pool arms the timer and state itself). */
export interface ParkInput<E> {
  key: string;
  environment: E;
  configFingerprint: string;
  historyFingerprint: string;
  credentialEpoch: CredentialEpoch;
  teardown: (reason: TeardownReason) => Promise<void>;
}

/**
 * A per-replica map of parked live sessions with an LRU cap and TTL reaping. Single-threaded
 * (Node), so check-and-set on a key needs no lock. All teardown routes through the session's
 * one idempotent `teardown`.
 */
export class SessionPool<E = unknown> {
  private readonly sessions = new Map<string, LiveSession<E>>();

  constructor(
    private readonly config: Pick<KeepaliveConfig, "poolMax">,
    private readonly logger: (message: string) => void = log,
    private readonly options: { strictCapacity?: boolean } = {},
  ) {}

  /** Peek without mutating. */
  get(key: string): LiveSession<E> | undefined {
    return this.sessions.get(key);
  }

  size(): number {
    return this.sessions.size;
  }

  keys(): string[] {
    return [...this.sessions.keys()];
  }

  /**
   * The awaiting_approval session for a session id, whatever its project scope (keys are
   * `<projectId>:<sessionId>`; transport-time callers know only the session id — the scope's
   * project half needs the mount sign, which has not happened yet). Peek only, no mutation.
   */
  awaitingApproval(sessionId: string): LiveSession<E> | undefined {
    const suffix = `:${sessionId}`;
    for (const session of this.sessions.values()) {
      if (session.state === "awaiting_approval" && session.key.endsWith(suffix))
        return session;
    }
    return undefined;
  }

  /** Test/inspection snapshot: key -> state. */
  snapshot(): Array<{ key: string; state: SessionState; lastUsed: number }> {
    return [...this.sessions.values()].map((s) => ({
      key: s.key,
      state: s.state,
      lastUsed: s.lastUsed,
    }));
  }

  /**
   * Check out an idle session for a continuation turn: clear its TTL timer, mark it busy, bump
   * its LRU stamp, and return it. Returns undefined when the key is absent or not idle (a busy
   * or awaiting_approval session is not checked out; the caller supersedes or falls to cold).
   */
  checkoutIdle(key: string): LiveSession<E> | undefined {
    const session = this.sessions.get(key);
    if (!session || session.state !== "idle") return undefined;
    this.clearTimer(session);
    session.state = "busy";
    session.lastUsed = Date.now();
    return session;
  }

  /**
   * Check out an approval-parked session for a live resume: clear its (longer) approval TTL timer,
   * mark it busy, and return it. Returns undefined when the key is absent or not
   * awaiting_approval. The default pool removes it so a racing request misses, preserving today's
   * local behavior. Strict capacity keeps it seated while busy so a reconnect consumes its warm
   * slot before any provider start. The state change still makes duplicate checkout impossible.
   */
  checkoutApproval(key: string): LiveSession<E> | undefined {
    const session = this.sessions.get(key);
    if (!session || session.state !== "awaiting_approval") return undefined;
    this.clearTimer(session);
    if (!this.options.strictCapacity) this.sessions.delete(key);
    session.state = "busy";
    session.lastUsed = Date.now();
    return session;
  }

  /**
   * Return a checked-out (busy) session to the pool after a completed turn: refresh its
   * fingerprints + credential epoch and re-arm the TTL timer, keeping the SAME live environment.
   * Two checkout shapes are handled:
   *  - `checkoutIdle` left the busy session IN the map: the slot must still hold this exact
   *    session (a racing turn may have superseded it — never clobber the newer one).
   *  - `checkoutApproval` REMOVED it from the map: re-insert only if the slot is still EMPTY;
   *    an occupant is a newer session parked by a racing request and must not be clobbered.
   * A destroyed session (e.g. drained by `destroyAll` mid-turn) is never resurrected.
   * Returns false when the session cannot return; the caller destroys its orphaned environment.
   */
  async repark(
    session: LiveSession<E>,
    update: {
      configFingerprint: string;
      historyFingerprint: string;
      credentialEpoch: CredentialEpoch;
    },
    ttlMs: number,
    state: "idle" | "awaiting_approval" = "idle",
  ): Promise<boolean> {
    if (session.state === "destroyed") return false;
    const current = this.sessions.get(session.key);
    if (current !== undefined && current !== session) return false;
    if (current === undefined) {
      // Re-inserting a checked-out-and-removed session: respect the cap like `park` does.
      if (
        this.sessions.size >= this.config.poolMax &&
        !(await this.evictLruIdle())
      ) {
        this.logger(
          `re-park skipped (pool full, nothing idle to evict) key=${session.key}`,
        );
        return false;
      }
      this.sessions.set(session.key, session);
    }
    this.clearTimer(session);
    session.configFingerprint = update.configFingerprint;
    session.historyFingerprint = update.historyFingerprint;
    session.credentialEpoch = update.credentialEpoch;
    session.state = state;
    session.lastUsed = Date.now();
    this.armTtl(session, ttlMs, state);
    this.logger(
      `park key=${session.key} ttl=${ttlMs}ms state=${state} (re-park) poolSize=${this.sessions.size}`,
    );
    return true;
  }

  /**
   * Best-effort park. LRU-evicts an idle entry when the pool is full; never evicts a busy or
   * awaiting_approval session. If nothing evictable frees a slot, the session is NOT parked and
   * the caller tears it down as today (parking is best-effort). Returns whether it parked.
   */
  async park(
    input: ParkInput<E>,
    ttlMs: number,
    state: "idle" | "awaiting_approval" = "idle",
  ): Promise<boolean> {
    // A supersede/re-park on the same key replaces any prior entry (destroy the old one first).
    // AWAIT the teardown before taking the slot, exactly like `evict`: the replaced session shares
    // the SAME durable cwd/mount as the successor, so its unmount/delete must complete BEFORE the
    // new session is parked, or the old destroy could unmount the cwd out from under the successor.
    const existing = this.sessions.get(input.key);
    if (existing) {
      this.clearTimer(existing);
      await this.removeAndTeardown(existing, "failed-turn");
    }

    if (
      this.sessions.size >= this.config.poolMax &&
      !(await this.evictLruIdle())
    ) {
      this.logger(
        `park skipped (pool full, nothing idle to evict) key=${input.key}`,
      );
      return false;
    }

    const session: LiveSession<E> = {
      key: input.key,
      environment: input.environment,
      configFingerprint: input.configFingerprint,
      historyFingerprint: input.historyFingerprint,
      credentialEpoch: input.credentialEpoch,
      state,
      lastUsed: Date.now(),
      teardown: input.teardown,
    };
    this.armTtl(session, ttlMs, state);
    this.sessions.set(input.key, session);
    this.logger(
      `park key=${input.key} ttl=${ttlMs}ms state=${state} poolSize=${this.sessions.size}`,
    );
    return true;
  }

  /**
   * Arm the TTL reaper on a parked session. An idle park uses the short idle TTL; an approval park
   * uses the longer approval TTL and logs `approval-ttl-expire` when it fires so an expired
   * approval (which degrades to the cold decision-map path) is greppable. Never lets the timer
   * keep the process alive on its own.
   */
  private armTtl(
    session: LiveSession<E>,
    ttlMs: number,
    state: "idle" | "awaiting_approval",
  ): void {
    const label =
      state === "awaiting_approval" ? "approval-ttl-expire" : "expire";
    session.ttlTimer = setTimeout(() => {
      this.logger(`${label} key=${session.key} (TTL ${ttlMs}ms)`);
      void this.evict(session.key, label, "idle-expiry");
    }, ttlMs);
    session.ttlTimer.unref?.();
  }

  /**
   * Remove a key and destroy it. Idempotent: a missing key is a no-op (resolves false).
   * The returned promise resolves once the destroy completed, so a caller that reacquires the
   * same key (same durable cwd / mount) MUST await it — the old teardown's unmount must not
   * overlap the new acquire. Fire-and-forget callers (the TTL timer) `void` it.
   * `label` feeds the greppable `[keepalive] evict` log line; `reason` drives engine teardown.
   */
  async evict(
    key: string,
    label: string,
    reason: TeardownReason,
  ): Promise<boolean> {
    const session = this.sessions.get(key);
    if (!session) return false;
    this.clearTimer(session);
    this.logger(`evict key=${key} reason=${label}`);
    await this.removeAndTeardown(session, reason);
    return true;
  }

  /**
   * Identity-checked eviction for a session THIS caller checked out: removes the map entry only
   * when the key still points at this exact session (a racing turn may have superseded it and
   * parked its own session under the same key — that newer session must not be clobbered), then
   * awaits the destroy of THIS session either way (its environment belongs to the caller and is
   * dead; destroy is idempotent, so a supersede that already destroyed it is a no-op).
   */
  async evictIfCurrent(
    session: LiveSession<E>,
    label: string,
    reason: TeardownReason,
  ): Promise<void> {
    if (this.sessions.get(session.key) === session) {
      this.clearTimer(session);
      this.logger(`evict key=${session.key} reason=${label}`);
      await this.removeAndTeardown(session, reason);
      return;
    }
    await this.safeTeardown(session, reason);
  }

  /** Remove a key and AWAIT its destroy. Idempotent. */
  async destroy(key: string, reason: TeardownReason = "kill"): Promise<void> {
    const session = this.sessions.get(key);
    if (!session) return;
    this.clearTimer(session);
    this.logger(`destroy key=${key}`);
    await this.removeAndTeardown(session, reason);
  }

  /**
   * Destroy every parked session, timeout-bounded so it can never hang shutdown (mirrors
   * `destroyInFlightSandboxes`). Drains the map first so a concurrent park cannot re-add.
   */
  async destroyAll(
    timeoutMs = 5000,
    reasonForIdle: TeardownReason = "kill",
    reasonForBusy: TeardownReason = reasonForIdle,
  ): Promise<void> {
    const pending = [...this.sessions.values()];
    if (!this.options.strictCapacity) this.sessions.clear();
    if (pending.length === 0) return;
    for (const session of pending) this.clearTimer(session);
    this.logger(`destroyAll count=${pending.length}`);
    const sweep = Promise.allSettled(
      pending.map((session) =>
        this.options.strictCapacity
          ? this.removeAndTeardown(
              session,
              session.state === "idle" ? reasonForIdle : reasonForBusy,
            )
          : this.safeTeardown(
              session,
              session.state === "idle" ? reasonForIdle : reasonForBusy,
            ),
      ),
    );
    await Promise.race([
      sweep,
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }

  private async evictLruIdle(): Promise<boolean> {
    let oldest: LiveSession<E> | undefined;
    for (const session of this.sessions.values()) {
      if (session.state !== "idle") continue;
      if (!oldest || session.lastUsed < oldest.lastUsed) oldest = session;
    }
    if (!oldest) return false;
    this.clearTimer(oldest);
    this.logger(`evict key=${oldest.key} reason=lru`);
    if (!this.options.strictCapacity) {
      this.sessions.delete(oldest.key);
      void this.safeTeardown(oldest, "capacity-eviction");
      return true;
    }

    await this.removeAndTeardown(oldest, "capacity-eviction");
    return true;
  }

  private async removeAndTeardown(
    session: LiveSession<E>,
    reason: TeardownReason,
  ): Promise<void> {
    if (!this.options.strictCapacity) {
      if (this.sessions.get(session.key) === session) {
        this.sessions.delete(session.key);
      }
      await this.safeTeardown(session, reason);
      return;
    }

    await this.safeTeardown(session, reason);
    // teardown() resolving is the confirmation signal. environment.destroy currently swallows a
    // failed stop plus failed delete, with Daytona's autostop and autodelete timers as the final
    // backstop. A reconciliation pass that confirms remote state is future work.
    if (this.sessions.get(session.key) === session) {
      this.sessions.delete(session.key);
    }
  }

  private clearTimer(session: LiveSession<E>): void {
    if (session.ttlTimer) {
      clearTimeout(session.ttlTimer);
      session.ttlTimer = undefined;
    }
  }

  private async safeTeardown(
    session: LiveSession<E>,
    reason: TeardownReason,
  ): Promise<void> {
    if (session.teardownPromise) {
      await session.teardownPromise;
      return;
    }
    session.state = "destroyed";
    session.teardownPromise = (async () => {
      try {
        await session.teardown(reason);
      } catch (err) {
        this.logger(
          `teardown failed key=${session.key}: ${String(
            err instanceof Error ? err.message : err,
          ).slice(0, 200)}`,
        );
      }
    })();
    await session.teardownPromise;
  }
}
