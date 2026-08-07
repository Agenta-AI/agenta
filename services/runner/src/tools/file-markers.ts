/**
 * Resolving `@ag.file` markers in a commit's operations (agent-config-editing, slice S3a).
 *
 * Contract: change-set.md sections 6.1, 6.5, and 6.6. The agent writes
 * `{"@ag.file": "<path>"}` wherever a string would go; the runner replaces each marker with
 * the file's text before the API sees the call. The engine refuses any marker that survives,
 * so resolution is not optional and a partial substitution is not a valid outcome.
 *
 * This module does the walk and the substitution, and returns the manifest the approval card
 * will render. It deliberately does NOT gate, freeze, or authorize: that is S3b, and it
 * lands after runner-spike's route work to avoid colliding in acp-interactions.
 */
import {
  ImportError,
  type ImportedFile,
  type WorkspaceReader,
} from "./workspace-reader.ts";
import { MAX_TOTAL_BYTES } from "./import-paths.ts";

export const FILE_MARKER = "@ag.file";

export interface MarkerLocation {
  /** Index in `delta.operations`. */
  operationIndex: number;
  /** JSON Pointer of the marker inside that operation's `value`. */
  valuePointer: string;
  path: string;
}

export interface ResolvedMarker extends MarkerLocation {
  file: ImportedFile;
}

export interface ImportManifest {
  entries: Array<{
    operationIndex: number;
    valuePointer: string;
    /** The path the agent wrote, for the card. */
    requestedPath: string;
    /** The path below the import root, after normalization. */
    relativePath: string;
    bytes: number;
    digest: string;
    /** Observed only. The stored `executable` field is the agent's to author. */
    executableBit: boolean;
  }>;
  totalBytes: number;
}

export interface ResolveMarkersResult {
  /** The arguments with every marker replaced by its text. */
  args: unknown;
  manifest: ImportManifest;
}

export class MarkerResolutionError extends Error {
  readonly code: string;
  readonly operationIndex?: number;
  readonly valuePointer?: string;
  readonly available?: string[];
  readonly nextStep: string;

  constructor(
    code: string,
    message: string,
    options: {
      operationIndex?: number;
      valuePointer?: string;
      available?: string[];
      nextStep?: string;
    } = {},
  ) {
    super(message);
    this.name = "MarkerResolutionError";
    this.code = code;
    this.operationIndex = options.operationIndex;
    this.valuePointer = options.valuePointer;
    this.available = options.available;
    this.nextStep =
      options.nextStep ??
      "Write the file under .agenta-imports/ first, then send the commit again.";
  }

  toDetail(): Record<string, unknown> {
    const detail: Record<string, unknown> = {
      code: this.code,
      message: this.message,
      next_step: this.nextStep,
      retryable: this.code !== "source_too_large",
    };
    if (this.operationIndex !== undefined) {
      detail.operation_index = this.operationIndex;
    }
    if (this.valuePointer !== undefined)
      detail.value_pointer = this.valuePointer;
    if (this.available !== undefined) detail.available = this.available;
    return detail;
  }
}

function escapeToken(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

function isMarker(node: unknown): node is Record<string, unknown> {
  return (
    typeof node === "object" &&
    node !== null &&
    !Array.isArray(node) &&
    FILE_MARKER in (node as Record<string, unknown>)
  );
}

/** Every marker in one operation's value, with its JSON Pointer. */
export function findMarkers(
  value: unknown,
  operationIndex: number,
  pointer = "",
): MarkerLocation[] {
  const found: MarkerLocation[] = [];
  if (isMarker(value)) {
    const raw = (value as Record<string, unknown>)[FILE_MARKER];
    found.push({
      operationIndex,
      valuePointer: pointer === "" ? "/" : pointer,
      path: typeof raw === "string" ? raw : "",
    });
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => {
      found.push(...findMarkers(child, operationIndex, `${pointer}/${index}`));
    });
    return found;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      found.push(
        ...findMarkers(child, operationIndex, `${pointer}/${escapeToken(key)}`),
      );
    }
  }
  return found;
}

/** Every marker across a whole operations delta, in operation then pointer order. */
export function findAllMarkers(args: unknown): MarkerLocation[] {
  const operations = operationsOf(args);
  if (!operations) return [];
  const found: MarkerLocation[] = [];
  operations.forEach((operation, index) => {
    if (typeof operation !== "object" || operation === null) return;
    const value = (operation as Record<string, unknown>).value;
    if (value === undefined) return;
    found.push(...findMarkers(value, index));
  });
  return found;
}

function operationsOf(args: unknown): unknown[] | null {
  const revision = (args as Record<string, unknown> | undefined)
    ?.workflow_revision;
  const delta = (revision as Record<string, unknown> | undefined)?.delta;
  const operations = (delta as Record<string, unknown> | undefined)?.operations;
  return Array.isArray(operations) ? operations : null;
}

function setAtPointer(root: unknown, pointer: string, next: unknown): void {
  if (pointer === "/" || pointer === "") {
    throw new MarkerResolutionError(
      "source_invalid",
      "a marker cannot replace the whole operation value",
    );
  }
  const tokens = pointer
    .split("/")
    .slice(1)
    .map((token) => token.replace(/~1/g, "/").replace(/~0/g, "~"));
  let node: Record<string, unknown> | unknown[] = root as Record<
    string,
    unknown
  >;
  for (const token of tokens.slice(0, -1)) {
    node = (node as Record<string, unknown>)[token] as Record<string, unknown>;
  }
  const last = tokens[tokens.length - 1];
  if (Array.isArray(node)) {
    node[Number.parseInt(last, 10)] = next;
  } else {
    (node as Record<string, unknown>)[last] = next;
  }
}

/**
 * Resolve every marker in one commit and substitute the text.
 *
 * All or nothing: a commit is one atomic change, so a partially resolvable one has no
 * useful meaning. The first failure throws and nothing is substituted.
 */
export async function resolveFileMarkers(
  args: unknown,
  reader: WorkspaceReader,
): Promise<ResolveMarkersResult> {
  const markers = findAllMarkers(args);
  if (markers.length === 0) {
    return { args, manifest: { entries: [], totalBytes: 0 } };
  }

  const resolved: ResolvedMarker[] = [];
  let totalBytes = 0;

  for (const marker of markers) {
    if (marker.path === "") {
      throw new MarkerResolutionError(
        "source_invalid",
        `${FILE_MARKER} needs a path string.`,
        {
          operationIndex: marker.operationIndex,
          valuePointer: marker.valuePointer,
          nextStep: `Give ${FILE_MARKER} the path of a file under .agenta-imports/.`,
        },
      );
    }
    let file: ImportedFile;
    try {
      file = await reader.readImportFile(marker.path);
    } catch (error) {
      throw toResolutionError(error, marker);
    }
    totalBytes += file.bytes;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new MarkerResolutionError(
        "source_too_large",
        `the commit's files total more than ${MAX_TOTAL_BYTES} bytes.`,
        {
          operationIndex: marker.operationIndex,
          valuePointer: marker.valuePointer,
          nextStep: "Commit fewer or smaller files.",
        },
      );
    }
    resolved.push({ ...marker, file });
  }

  // Substitution happens only after EVERY marker resolved, so a later failure cannot leave
  // half-substituted arguments behind.
  const next = structuredClone(args) as Record<string, unknown>;
  const operations = operationsOf(next);
  for (const marker of resolved) {
    const operation = operations?.[marker.operationIndex] as Record<
      string,
      unknown
    >;
    setAtPointer(operation.value, marker.valuePointer, marker.file.content);
  }

  return {
    args: next,
    manifest: {
      entries: resolved.map((marker) => ({
        operationIndex: marker.operationIndex,
        valuePointer: marker.valuePointer,
        requestedPath: marker.path,
        relativePath: marker.file.relativePath,
        bytes: marker.file.bytes,
        digest: marker.file.digest,
        executableBit: marker.file.executableBit,
      })),
      totalBytes,
    },
  };
}

function toResolutionError(
  error: unknown,
  marker: MarkerLocation,
): MarkerResolutionError {
  if (error instanceof ImportError) {
    return new MarkerResolutionError(error.code, error.message, {
      operationIndex: marker.operationIndex,
      valuePointer: marker.valuePointer,
      available: error.available,
      nextStep:
        error.code === "source_not_found"
          ? "Write the file under .agenta-imports/ first, then send the commit again."
          : error.code === "source_too_large"
            ? "Reference a smaller file."
            : "Reference a UTF-8 text file under .agenta-imports/.",
    });
  }
  return new MarkerResolutionError(
    "source_invalid",
    error instanceof Error ? error.message : String(error),
    {
      operationIndex: marker.operationIndex,
      valuePointer: marker.valuePointer,
    },
  );
}
