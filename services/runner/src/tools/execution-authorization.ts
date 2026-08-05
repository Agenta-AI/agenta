/**
 * Single-use execution authorization (slice S3b, core only).
 *
 * Contract: docs/design/agent-config-editing/contracts/execution-authorization.md.
 *
 * This replaces the tool-call-id cache, which was not safe: a tool-call id is CORRELATION,
 * not authorization. It is a bearer-free record that binds what was approved to what
 * executes, so an attacker who can write a relay record cannot execute different arguments,
 * different content, or the same call twice.
 *
 * Pure module. It performs no I/O and knows nothing about the relay, the approval surface,
 * or the harness; wiring lands in a later slice.
 */
import { createHash } from "node:crypto";

import {
  FrozenValueStore,
  type FrozenValueHandle,
} from "./frozen-value-store.ts";
import {
  StrictSerializationError,
  strictCanonicalJson,
} from "./strict-canonical-json.ts";

/** Contract 2.1. One record covers one MARKER, not one operation. */
export interface ExecutionAuthorization {
  authorizationId: string;
  toolName: string;
  toolCallId: string;
  argsDigest: string;
  frozenValueRef: FrozenValueHandle;
  contentDigest: string;
  manifestDigest: string;
  catalogGeneration: string;
  sourcePath: string;
  operationIndex: number;
  valuePointer: string;
  createdAtMs: number;
  expiresAtMs: number;
  consumed: boolean;
  turnId: string;
  sessionId: string;
}

export type AuthorizationFailure =
  | "missing_record"
  | "already_consumed"
  | "expired"
  | "tool_mismatch"
  | "args_mismatch"
  | "generation_mismatch"
  | "content_mismatch"
  | "frozen_value_missing"
  | "extra_record"
  | "unserializable_arguments";

export class AuthorizationError extends Error {
  readonly reason: AuthorizationFailure;
  readonly operationIndex?: number;
  readonly valuePointer?: string;

  constructor(
    reason: AuthorizationFailure,
    message: string,
    options: { operationIndex?: number; valuePointer?: string } = {},
  ) {
    super(message);
    this.name = "AuthorizationError";
    this.reason = reason;
    this.operationIndex = options.operationIndex;
    this.valuePointer = options.valuePointer;
  }
}

export function strictDigest(value: unknown): string {
  return createHash("sha256")
    .update(strictCanonicalJson(value), "utf8")
    .digest("hex");
}

/** The identity of one marker within one call. Contract 3.4. */
export interface MarkerKey {
  operationIndex: number;
  valuePointer: string;
}

function keyOf(toolCallId: string, marker: MarkerKey): string {
  return `${toolCallId}\0${marker.operationIndex}\0${marker.valuePointer}`;
}

export interface MintInput {
  toolName: string;
  toolCallId: string;
  /** The model's ORIGINAL arguments: still holding the markers, not the resolved values. */
  originalArgs: unknown;
  /** The fully resolved value this marker will substitute. */
  resolvedValue: unknown;
  resolvedBytes: number;
  manifest: unknown;
  catalogGeneration: string;
  sourcePath: string;
  marker: MarkerKey;
  turnId: string;
  sessionId: string;
}

export interface AuthorizationStoreOptions {
  /** Contract 6.3. Long enough for a human to read a card, short enough to bound a replay. */
  ttlMs?: number;
  now?: () => number;
  newId?: () => string;
}

const DEFAULT_TTL_MS = 15 * 60 * 1000;

let counter = 0;

export class ExecutionAuthorizationStore {
  private readonly records = new Map<string, ExecutionAuthorization>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(
    private readonly frozen: FrozenValueStore,
    options: AuthorizationStoreOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? (() => Date.now());
    this.newId = options.newId ?? (() => `auth-${++counter}-${Date.now()}`);
  }

  /**
   * Contract 3.1. Minting fails closed: a value the strict serializer refuses does not get a
   * weaker key, it gets no record. This is deliberately stricter than the lenient approval
   * matcher, which may silently no-op on an unkeyable call.
   */
  mint(input: MintInput): ExecutionAuthorization {
    let argsDigest: string;
    let contentDigest: string;
    let manifestDigest: string;
    try {
      argsDigest = strictDigest(input.originalArgs);
      contentDigest = strictDigest(input.resolvedValue);
      manifestDigest = strictDigest(input.manifest);
    } catch (error) {
      if (error instanceof StrictSerializationError) {
        throw new AuthorizationError(
          "unserializable_arguments",
          `the call cannot be authorized exactly: ${error.message}`,
          input.marker,
        );
      }
      throw error;
    }

    const handle = this.frozen.put(
      input.turnId,
      input.resolvedValue,
      input.resolvedBytes,
    );
    const createdAtMs = this.now();

    const record: ExecutionAuthorization = {
      authorizationId: this.newId(),
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      argsDigest,
      frozenValueRef: handle,
      contentDigest,
      manifestDigest,
      catalogGeneration: input.catalogGeneration,
      sourcePath: input.sourcePath,
      operationIndex: input.marker.operationIndex,
      valuePointer: input.marker.valuePointer,
      createdAtMs,
      expiresAtMs: createdAtMs + this.ttlMs,
      consumed: false,
      turnId: input.turnId,
      sessionId: input.sessionId,
    };

    this.records.set(keyOf(input.toolCallId, input.marker), record);
    return record;
  }

  get(
    toolCallId: string,
    marker: MarkerKey,
  ): ExecutionAuthorization | undefined {
    return this.records.get(keyOf(toolCallId, marker));
  }

  /** Every record held for one call, whether or not the executed call still wants it. */
  recordsFor(toolCallId: string): ExecutionAuthorization[] {
    const prefix = `${toolCallId}\0`;
    const found: ExecutionAuthorization[] = [];
    for (const [key, record] of this.records) {
      if (key.startsWith(prefix)) found.push(record);
    }
    return found;
  }

  /**
   * The `toolCallId` of a set minted for THIS tool with THESE exact arguments, when the executing
   * caller reports a different id.
   *
   * WHY THIS EXISTS. The gate and the execution do not always see one id. A non-Pi harness gates
   * an MCP tool under its OWN call id, and the in-sandbox shim later relays the same call under a
   * uuid it generates, because a `tools/call` carries no harness id for it to reuse. Both ids name
   * one call. Keying the lookup on the id alone therefore failed every approved import on that
   * path, which is the whole point of the record.
   *
   * WHY IT IS NOT A WEAKENING. The id was never the authorization. This module says so in its own
   * header: a tool-call id is CORRELATION. The binding is `argsDigest`, over the model's original
   * arguments through the strict serializer, plus the tool name. A caller that cannot reproduce
   * both byte for byte matches nothing here, and one that can is asking to run the call the human
   * approved, with the frozen bytes, which is what would have run anyway. Every other check in
   * `verifyAll` still applies to the set this returns.
   *
   * The residual is a denial of service, not an escalation. A process that can write the relay
   * directory can spend an approval before the harness's own call arrives, and that call then
   * fails closed. Such a process can already stop the same commit by simpler means.
   *
   * Only a COMPLETE, unconsumed, unexpired set matches, and the FIRST such set wins so two
   * identical approved commits are consumed one at a time.
   */
  findSetByCall(input: {
    toolName: string;
    argsDigest: string;
    requiredMarkers: MarkerKey[];
  }): string | undefined {
    const now = this.now();
    const byCall = new Map<string, ExecutionAuthorization[]>();
    for (const record of this.records.values()) {
      const group = byCall.get(record.toolCallId);
      if (group) group.push(record);
      else byCall.set(record.toolCallId, [record]);
    }
    for (const [toolCallId, group] of byCall) {
      if (group.length !== input.requiredMarkers.length) continue;
      const usable = group.every(
        (record) =>
          record.toolName === input.toolName &&
          record.argsDigest === input.argsDigest &&
          !record.consumed &&
          now < record.expiresAtMs,
      );
      if (!usable) continue;
      // The set must cover exactly the markers this call carries, so a partial match cannot
      // stand in for the commit that was approved.
      const covered = input.requiredMarkers.every((marker) =>
        this.records.has(keyOf(toolCallId, marker)),
      );
      if (covered) return toolCallId;
    }
    return undefined;
  }

  /**
   * Contract 3.4.2. Verify the COMPLETE set before consuming any of it. No mutation here.
   *
   * A missing record fails closed. Section 4's single exception (an explicitly ungated
   * call) is the caller's to apply, not this store's: an authorization store that decides
   * when authorization is optional is not an authorization store.
   */
  verifyAll(input: {
    toolName: string;
    toolCallId: string;
    executedArgs: unknown;
    requiredMarkers: MarkerKey[];
    catalogGeneration: string;
  }): ExecutionAuthorization[] {
    let executedDigest: string;
    try {
      executedDigest = strictDigest(input.executedArgs);
    } catch (error) {
      throw new AuthorizationError(
        "unserializable_arguments",
        error instanceof Error ? error.message : String(error),
      );
    }

    const verified: ExecutionAuthorization[] = [];
    const now = this.now();

    for (const marker of input.requiredMarkers) {
      const record = this.records.get(keyOf(input.toolCallId, marker));
      if (!record) {
        throw new AuthorizationError(
          "missing_record",
          "no execution authorization for this marker",
          marker,
        );
      }
      if (record.consumed) {
        throw new AuthorizationError(
          "already_consumed",
          "this authorization was already used",
          marker,
        );
      }
      if (now >= record.expiresAtMs) {
        throw new AuthorizationError(
          "expired",
          "this authorization expired",
          marker,
        );
      }
      if (record.toolName !== input.toolName) {
        // A forged record that names a different tool but reuses the call id.
        throw new AuthorizationError(
          "tool_mismatch",
          "the authorization was minted for a different tool",
          marker,
        );
      }
      if (record.argsDigest !== executedDigest) {
        // The same-id argument-substitution case: same call id, different arguments.
        throw new AuthorizationError(
          "args_mismatch",
          "the executed arguments differ from the approved ones",
          marker,
        );
      }
      if (record.catalogGeneration !== input.catalogGeneration) {
        throw new AuthorizationError(
          "generation_mismatch",
          "the tool catalog changed since this call was approved",
          marker,
        );
      }
      if (!this.frozen.has(record.frozenValueRef)) {
        // Never re-read the workspace to recover: the approved bytes are gone, so there is
        // nothing to prove the execution matches.
        throw new AuthorizationError(
          "frozen_value_missing",
          "the approved content is no longer held",
          marker,
        );
      }
      const frozen = this.frozen.get(record.frozenValueRef);
      if (strictDigest(frozen) !== record.contentDigest) {
        throw new AuthorizationError(
          "content_mismatch",
          "the held content does not match what was approved",
          marker,
        );
      }
      verified.push(record);
    }

    // No extra member: a record with no matching marker means the executed call is not the
    // approved call. This catches removing an operation, or one marker from an operation,
    // out of an approved multi-marker commit.
    const required = new Set(
      input.requiredMarkers.map((marker) => keyOf(input.toolCallId, marker)),
    );
    for (const record of this.recordsFor(input.toolCallId)) {
      if (!required.has(keyOf(input.toolCallId, record))) {
        throw new AuthorizationError(
          "extra_record",
          "an approved marker is missing from the executed call",
          {
            operationIndex: record.operationIndex,
            valuePointer: record.valuePointer,
          },
        );
      }
    }

    return verified;
  }

  /**
   * Contract 3.4.3. Consume the complete set in ONE synchronous pass.
   *
   * There is no `await` in here, and there must never be one: JavaScript runs this to
   * completion without interleaving, so a concurrent forged execute cannot consume half the
   * set in the middle. An await between two consumes would open exactly that window.
   */
  consumeAll(
    toolCallId: string,
    markers: MarkerKey[],
  ): Array<{ record: ExecutionAuthorization; value: unknown }> {
    const claimed: Array<{ record: ExecutionAuthorization; value: unknown }> =
      [];

    for (const marker of markers) {
      const key = keyOf(toolCallId, marker);
      const record = this.records.get(key);
      if (!record || record.consumed) {
        // Verification passed moments ago in this same synchronous turn, so a consumed
        // member here is a bug, not a recoverable state. Restore nothing, execute nothing.
        this.discardAll(toolCallId);
        throw new AuthorizationError(
          record ? "already_consumed" : "missing_record",
          "the authorization set changed between verify and consume",
          marker,
        );
      }
      const value = this.frozen.get(record.frozenValueRef);
      if (value === undefined) {
        this.discardAll(toolCallId);
        throw new AuthorizationError(
          "frozen_value_missing",
          "the approved content is no longer held",
          marker,
        );
      }
      record.consumed = true;
      this.records.delete(key);
      claimed.push({ record, value });
    }

    return claimed;
  }

  /**
   * Contract 3.4.5. Any failure discards EVERY record for the call and releases its frozen
   * values. No surviving member is left for a retry: a retry re-mints the whole set, so the
   * human re-approves the whole commit.
   */
  discardAll(toolCallId: string): number {
    const prefix = `${toolCallId}\0`;
    let discarded = 0;
    for (const [key, record] of this.records) {
      if (key.startsWith(prefix)) {
        this.frozen.release(record.frozenValueRef);
        this.records.delete(key);
        discarded += 1;
      }
    }
    return discarded;
  }

  /** Contract 6.3. Sweeping expired records bounds memory when a call is never executed. */
  sweepExpired(): number {
    const now = this.now();
    let swept = 0;
    for (const [key, record] of this.records) {
      if (now >= record.expiresAtMs) {
        this.frozen.release(record.frozenValueRef);
        this.records.delete(key);
        swept += 1;
      }
    }
    return swept;
  }

  get size(): number {
    return this.records.size;
  }
}
