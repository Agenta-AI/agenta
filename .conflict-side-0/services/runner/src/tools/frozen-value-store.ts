/**
 * The per-turn frozen-value store (slice S3b).
 *
 * Contract: docs/design/agent-config-editing/contracts/execution-authorization.md 5 and 6.
 *
 * What the human approves is what gets committed. The runner resolves the workspace content
 * ONCE, before the approval card, and keeps those exact bytes here. Execution reads them
 * back by handle; it never re-reads the workspace, because a re-read is a second chance for
 * the content to differ from what was shown.
 *
 * The store holds bytes, so it is also where a memory leak would live. Every entry is scoped
 * to one turn, capped, and released on discard.
 */

export interface FrozenValueHandle {
  readonly id: string;
  readonly turnId: string;
}

interface FrozenEntry {
  turnId: string;
  value: unknown;
  bytes: number;
  createdAtMs: number;
}

export class FrozenValueLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrozenValueLimitError";
  }
}

export interface FrozenValueStoreOptions {
  /** Contract 6.2: one turn's total frozen bytes. */
  maxTurnBytes?: number;
  /** Contract 6.2: how many sources one turn may freeze. */
  maxTurnEntries?: number;
  now?: () => number;
  newId?: () => string;
}

const DEFAULT_MAX_TURN_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_TURN_ENTRIES = 32;

let counter = 0;

export class FrozenValueStore {
  private readonly entries = new Map<string, FrozenEntry>();
  private readonly maxTurnBytes: number;
  private readonly maxTurnEntries: number;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(options: FrozenValueStoreOptions = {}) {
    this.maxTurnBytes = options.maxTurnBytes ?? DEFAULT_MAX_TURN_BYTES;
    this.maxTurnEntries = options.maxTurnEntries ?? DEFAULT_MAX_TURN_ENTRIES;
    this.now = options.now ?? (() => Date.now());
    this.newId = options.newId ?? (() => `frozen-${++counter}-${Date.now()}`);
  }

  /** Store one resolved value and return its handle. The caller keeps the handle, not the
   *  bytes: a record that carried the bytes would copy them into logs and interaction rows. */
  put(turnId: string, value: unknown, bytes: number): FrozenValueHandle {
    const current = this.usageFor(turnId);
    if (current.entries + 1 > this.maxTurnEntries) {
      throw new FrozenValueLimitError(
        `this turn already froze ${current.entries} sources; the limit is ${this.maxTurnEntries}`,
      );
    }
    if (current.bytes + bytes > this.maxTurnBytes) {
      throw new FrozenValueLimitError(
        `this turn's frozen content would exceed ${this.maxTurnBytes} bytes`,
      );
    }

    const id = this.newId();
    this.entries.set(id, { turnId, value, bytes, createdAtMs: this.now() });
    return { id, turnId };
  }

  /** The frozen value, or undefined when it was released. A missing value must fail the
   *  call closed; it must never trigger a re-read of the workspace. */
  get(handle: FrozenValueHandle): unknown | undefined {
    const entry = this.entries.get(handle.id);
    if (!entry || entry.turnId !== handle.turnId) return undefined;
    return entry.value;
  }

  has(handle: FrozenValueHandle): boolean {
    const entry = this.entries.get(handle.id);
    return Boolean(entry && entry.turnId === handle.turnId);
  }

  release(handle: FrozenValueHandle): void {
    const entry = this.entries.get(handle.id);
    if (entry && entry.turnId === handle.turnId) this.entries.delete(handle.id);
  }

  /** Drop everything a turn froze. Called on discard, on failure, and at turn end. */
  releaseTurn(turnId: string): number {
    let released = 0;
    for (const [id, entry] of this.entries) {
      if (entry.turnId === turnId) {
        this.entries.delete(id);
        released += 1;
      }
    }
    return released;
  }

  usageFor(turnId: string): { entries: number; bytes: number } {
    let entries = 0;
    let bytes = 0;
    for (const entry of this.entries.values()) {
      if (entry.turnId === turnId) {
        entries += 1;
        bytes += entry.bytes;
      }
    }
    return { entries, bytes };
  }

  get size(): number {
    return this.entries.size;
  }
}
