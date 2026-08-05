/**
 * Marker resolution at the gate, and verify-and-consume at execution (slice S3b).
 *
 * Contracts:
 *   execution-authorization.md (the record, the lifecycle, the single exception)
 *   workspace-import.md 8      (the approval manifest and the card)
 *   change-set.md 6            (the `@ag.file` marker)
 *
 * This module is the seam between "a human approved a change" and "the runner executed one".
 * Two entry points, and the asymmetry between them is the whole point:
 *
 *   mintForGate       — runs at the permission gate, BEFORE the card. Resolves every marker,
 *                       freezes the exact bytes, mints one record per marker, and returns the
 *                       manifest the card renders.
 *   authorizeExecution — runs at the relay, for EVERY harness. Verifies the complete set,
 *                       consumes it, substitutes the frozen bytes, and returns the arguments to
 *                       execute. A missing record fails the call closed.
 *
 * Why the execution check cannot live in the relay guard: the guard passes every `ask` verdict
 * on a non-Pi harness, because those harnesses raise their own dialog and the runner records no
 * grant for it. That pass is a COMPATIBILITY behavior, not a policy statement — reading it as
 * policy is what leaves a forged request file able to start an `ask` tool with no dialog. This
 * check therefore runs independently of the guard, requires a record the runner itself minted,
 * and consumes it exactly once. That is what closes the hole for a marker-carrying commit.
 */
import {
  ExecutionAuthorizationStore,
  AuthorizationError,
  strictDigest,
  type MarkerKey,
} from "./execution-authorization.ts";
import { FrozenValueLimitError } from "./frozen-value-store.ts";
import {
  MarkerResolutionError,
  findAllMarkers,
  resolveFileMarkers,
  setAtPointer,
  type MarkerLocation,
} from "./file-markers.ts";
import {
  buildApprovalManifest,
  buildDiffEntry,
  type ApprovalManifest,
  type ManifestDiffEntry,
} from "./approval-manifest.ts";
import { digestOf, type WorkspaceReader } from "./workspace-reader.ts";

/** Contract 6.2. Bounds one commit. */
export const MAX_MARKERS_PER_CALL = 8;

/**
 * The old text of one configuration field, at one exact revision.
 *
 * The revision is not optional and it is not the session's. The session may be running revision
 * N while the model correctly supplies head N+1 as `base_revision_id`; diffing against N would
 * show the human an N-to-new change, the base check would still pass (the base really is N+1),
 * and a commit would replace N+1 with text the human never compared against it. Nothing would
 * fail, and the wrong thing would commit.
 *
 * Rejecting is the correct answer to a fetch failure. See `source_base_unavailable`.
 */
export type ConfigTextFetcher = (input: {
  revisionId: string;
  target: unknown[];
}) => Promise<string>;

export type CommitAuthorizationCode =
  | "authorization_missing"
  | "authorization_consumed"
  | "authorization_expired"
  | "authorization_mismatch"
  | "catalog_generation_stale"
  | "source_limit_exceeded"
  | "source_base_unavailable";

export class CommitAuthorizationError extends Error {
  readonly code: CommitAuthorizationCode;
  readonly retryable: boolean;
  readonly nextStep: string;

  constructor(
    code: CommitAuthorizationCode,
    message: string,
    options: { retryable?: boolean; nextStep?: string } = {},
  ) {
    super(message);
    this.name = "CommitAuthorizationError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.nextStep = options.nextStep ?? "Send the commit again.";
  }

  /** The tool-result text the model sees. The runner keeps the detail in its own logs. */
  toResultText(): string {
    return `${this.code}: ${this.message} ${this.nextStep}`.trim();
  }
}

const AUTHORIZATION_FAILURE_CODES: Record<string, CommitAuthorizationCode> = {
  missing_record: "authorization_missing",
  extra_record: "authorization_missing",
  already_consumed: "authorization_consumed",
  expired: "authorization_expired",
  tool_mismatch: "authorization_mismatch",
  args_mismatch: "authorization_mismatch",
  content_mismatch: "authorization_mismatch",
  frozen_value_missing: "authorization_mismatch",
  unserializable_arguments: "authorization_mismatch",
  generation_mismatch: "catalog_generation_stale",
};

function toCommitError(error: unknown): CommitAuthorizationError {
  if (error instanceof CommitAuthorizationError) return error;
  if (error instanceof AuthorizationError) {
    const code =
      AUTHORIZATION_FAILURE_CODES[error.reason] ?? "authorization_mismatch";
    return new CommitAuthorizationError(code, error.message, {
      retryable:
        code === "authorization_expired" || code === "catalog_generation_stale",
      nextStep:
        code === "authorization_expired" || code === "catalog_generation_stale"
          ? "Send the commit again to get a fresh approval."
          : "Reissue the call; this one was not approved as sent.",
    });
  }
  if (error instanceof FrozenValueLimitError) {
    return new CommitAuthorizationError(
      "source_limit_exceeded",
      error.message,
      {
        nextStep: "Reference fewer or smaller files in one turn.",
      },
    );
  }
  throw error;
}

interface OperationView {
  index: number;
  operation: string | undefined;
  target: unknown[];
  value: unknown;
}

function operationsOf(args: unknown): OperationView[] {
  const revision = (args as Record<string, unknown> | undefined)
    ?.workflow_revision;
  const delta = (revision as Record<string, unknown> | undefined)?.delta;
  const operations = (delta as Record<string, unknown> | undefined)?.operations;
  if (!Array.isArray(operations)) return [];
  return operations.map((operation, index) => {
    const record = (
      typeof operation === "object" && operation !== null ? operation : {}
    ) as Record<string, unknown>;
    return {
      index,
      operation:
        typeof record.operation === "string" ? record.operation : undefined,
      target: Array.isArray(record.target) ? record.target : [],
      value: record.value,
    };
  });
}

function baseRevisionIdOf(args: unknown): string | undefined {
  const revision = (args as Record<string, unknown> | undefined)
    ?.workflow_revision as Record<string, unknown> | undefined;
  const id = revision?.base_revision_id;
  return typeof id === "string" && id ? id : undefined;
}

/**
 * A marker that replaces a WHOLE field value is the single-text presentation: the operation is
 * a `set` and its entire `value` came from one file. That is the founding use case (an
 * oversized instructions document), and it is the one case where the card owes the human a
 * diff rather than a file listing.
 */
function isSingleTextSet(
  operation: OperationView | undefined,
  marker: MarkerLocation,
): boolean {
  return operation?.operation === "set" && marker.valuePointer === "/";
}

export interface CommitAuthorizerOptions {
  reader: WorkspaceReader;
  store: ExecutionAuthorizationStore;
  /** Read ONCE per mint, so a set of records never ages apart. */
  catalogGeneration: () => string;
  fetchOldText: ConfigTextFetcher;
  turnId: string;
  sessionId: string;
  /**
   * The permission-plan verdict for an execute record the runner never gated.
   *
   * Contract 4: inline resolution happens ONLY on an explicit `allow`. This is a narrow,
   * positive statement by the policy owner — not a cache miss, and not the relay guard's
   * non-Pi `ask` pass-through, which is compatibility behavior.
   */
  decideInline: (toolName: string, args: unknown) => "allow" | "gate";
  log?: (msg: string) => void;
}

export class CommitAuthorizer {
  constructor(private readonly options: CommitAuthorizerOptions) {}

  /** Every marker the call carries. Cheap and side-effect free: it reads no file. */
  markersIn(args: unknown): MarkerLocation[] {
    return findAllMarkers(args);
  }

  /**
   * Contract 3.1 and 3.4.1. Resolve, freeze, mint, and return the manifest for the card.
   *
   * The CALLER must have a non-deny verdict before calling this. A denied call must not touch
   * the filesystem: reading a file for a call that will never run leaks its existence and its
   * content into runner memory, spends the turn's byte budget, and on Daytona runs a process
   * inside the sandbox for a call the policy already refused.
   */
  async mintForGate(input: {
    toolName: string;
    toolCallId: string;
    args: unknown;
  }): Promise<ApprovalManifest | undefined> {
    const markers = this.markersIn(input.args);
    if (markers.length === 0) return undefined;

    // Limits are checked BEFORE any read, for the same reason the verdict is.
    if (markers.length > MAX_MARKERS_PER_CALL) {
      throw new CommitAuthorizationError(
        "source_limit_exceeded",
        `this commit references ${markers.length} files; the limit is ${MAX_MARKERS_PER_CALL}.`,
        { nextStep: "Split the change into smaller commits." },
      );
    }

    const resolved = await resolveFileMarkers(input.args, this.options.reader);
    const operations = operationsOf(resolved.args);
    const generation = this.options.catalogGeneration();

    // The diffs need a network fetch, so they happen BEFORE anything is minted: a fetch failure
    // must leave no record and no frozen bytes behind.
    const diffs = await this.buildDiffs(input.args, resolved, operations);

    const contentDigest = strictDigest(resolved.args);
    const manifest = buildApprovalManifest({
      imports: resolved.manifest,
      diffs,
      catalogGeneration: generation,
      contentDigest,
    });

    try {
      const minted = resolved.markers.map((marker) =>
        this.options.store.mint({
          toolName: input.toolName,
          toolCallId: input.toolCallId,
          // The model's ORIGINAL arguments, still holding the markers. The digest binds what
          // the model wrote, so a substituted-argument replay cannot match it.
          originalArgs: input.args,
          resolvedValue: marker.file.content,
          resolvedBytes: marker.file.bytes,
          manifest,
          catalogGeneration: generation,
          sourcePath: marker.path,
          marker: {
            operationIndex: marker.operationIndex,
            valuePointer: marker.valuePointer,
          },
          turnId: this.options.turnId,
          sessionId: this.options.sessionId,
        }),
      );
      // Contract 3.4.1: one expiry for the set. Minting walks a loop, so two records could
      // otherwise straddle a millisecond and age apart; the store hands back its own record
      // objects, so normalizing here normalizes what verification will read.
      const sharedExpiry = Math.min(
        ...minted.map((record) => record.expiresAtMs),
      );
      for (const record of minted) record.expiresAtMs = sharedExpiry;
      return manifest;
    } catch (error) {
      // A partially minted set has no useful meaning: a commit is one atomic change.
      this.options.store.discardAll(input.toolCallId);
      throw toCommitError(error);
    }
  }

  private async buildDiffs(
    originalArgs: unknown,
    resolved: Awaited<ReturnType<typeof resolveFileMarkers>>,
    operations: OperationView[],
  ): Promise<ManifestDiffEntry[]> {
    const singleText = resolved.markers.filter((marker) =>
      isSingleTextSet(operations[marker.operationIndex], marker),
    );
    if (singleText.length === 0) return [];

    const baseRevisionId = baseRevisionIdOf(originalArgs);
    if (!baseRevisionId) {
      // Without a base there is no honest old side, and 8.4.3 refuses to show a new text
      // without the text it replaces.
      throw new CommitAuthorizationError(
        "source_base_unavailable",
        "the commit replaces a field from a file but carries no base_revision_id, so the change cannot be shown against what it replaces.",
        {
          retryable: true,
          nextStep:
            "Call read_config, copy its base_revision_id into the commit, and send it again.",
        },
      );
    }

    const diffs: ManifestDiffEntry[] = [];
    for (const marker of singleText) {
      const operation = operations[marker.operationIndex];
      let oldText: string;
      try {
        oldText = await this.options.fetchOldText({
          revisionId: baseRevisionId,
          target: operation.target,
        });
      } catch (error) {
        // Fail closed. "Unavailable" never means "there is none": a `set` replaces a field that
        // already holds a string, so an old text always exists somewhere. Presenting a fetch
        // failure as a complete-content approval would invite the human to approve a
        // replacement without seeing what it replaces, which is the one thing this mode exists
        // to prevent.
        throw new CommitAuthorizationError(
          "source_base_unavailable",
          `the current text of ${JSON.stringify(operation.target)} could not be read at revision ${baseRevisionId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { retryable: true, nextStep: "Send the commit again." },
        );
      }
      diffs.push(
        buildDiffEntry({
          operationIndex: marker.operationIndex,
          target: operation.target,
          baseRevisionId,
          oldText,
          oldDigest: digestOf(oldText),
          newText: marker.file.content,
          newDigest: marker.file.digest,
        }),
      );
    }
    return diffs;
  }

  /**
   * Contract 3.2, 3.4.2 to 3.4.4. Verify the complete set, consume it, and substitute.
   *
   * Runs for EVERY harness and does not depend on a dialog having been raised. A call carrying
   * markers with no authorization fails closed here, which is what makes a forged relay record
   * useless on the non-Pi `ask` path.
   */
  async authorizeExecution(input: {
    toolName: string;
    toolCallId: string;
    args: unknown;
  }): Promise<{ ok: true; args: unknown } | { ok: false; reason: string }> {
    const required = this.markersIn(input.args);
    if (required.length === 0) return { ok: true, args: input.args };

    try {
      if (this.options.store.recordsFor(input.toolCallId).length === 0) {
        // Contract 4, the one exception. An `allow` verdict is a positive statement by the
        // policy owner; a missing record is the absence of information. Only the first permits
        // an inline resolution, and it still mints, verifies, and consumes, so there is exactly
        // one execution path and one set of digests.
        if (this.options.decideInline(input.toolName, input.args) !== "allow") {
          throw new CommitAuthorizationError(
            "authorization_missing",
            "this commit references workspace files but was never approved.",
            { nextStep: "Reissue the call so it can be approved." },
          );
        }
        this.options.log?.(
          `[commit-auth] inline resolution on an allow verdict tool=${input.toolName} call=${input.toolCallId}`,
        );
        await this.mintForGate(input);
      }

      // Everything below is SYNCHRONOUS on purpose, with no `await` between the verify and the
      // execute. JavaScript runs it to completion without interleaving, so a concurrent forged
      // record cannot consume part of the set in the middle and execute a different commit.
      const markers: MarkerKey[] = required.map((marker) => ({
        operationIndex: marker.operationIndex,
        valuePointer: marker.valuePointer,
      }));
      this.options.store.verifyAll({
        toolName: input.toolName,
        toolCallId: input.toolCallId,
        executedArgs: input.args,
        requiredMarkers: markers,
        catalogGeneration: this.options.catalogGeneration(),
      });
      const claimed = this.options.store.consumeAll(input.toolCallId, markers);
      return { ok: true, args: substitute(input.args, claimed) };
    } catch (error) {
      // Any failure discards every record for the call and releases every frozen value. No
      // surviving member is left for a retry: a retry re-mints the whole set, so the human
      // re-approves the whole commit.
      this.options.store.discardAll(input.toolCallId);
      const failure = toCommitError(error);
      this.options.log?.(
        `[commit-auth] refused tool=${input.toolName} call=${input.toolCallId} code=${failure.code}`,
      );
      return { ok: false, reason: failure.toResultText() };
    }
  }
}

/** Substitute every frozen value into a COPY of the call body, then hand it back. The runner
 *  never rereads the workspace here: the approved bytes are the only bytes that execute. */
function substitute(
  args: unknown,
  claimed: Array<{
    record: { operationIndex: number; valuePointer: string };
    value: unknown;
  }>,
): unknown {
  const next = structuredClone(args) as Record<string, unknown>;
  const revision = next.workflow_revision as
    | Record<string, unknown>
    | undefined;
  const delta = revision?.delta as Record<string, unknown> | undefined;
  const operations = delta?.operations as unknown[] | undefined;
  for (const { record, value } of claimed) {
    const operation = operations?.[record.operationIndex];
    if (!operation) {
      throw new CommitAuthorizationError(
        "authorization_mismatch",
        "the executed call no longer has the approved operation.",
      );
    }
    setAtPointer(operation, record.valuePointer, value);
  }
  return next;
}

export { MarkerResolutionError };
