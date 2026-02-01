/**
 * Playground Snapshot Module
 *
 * Provides schema, encoding/decoding, and validation for playground URL snapshots.
 *
 * @example
 * ```typescript
 * import {
 *     encodeSnapshot,
 *     parseSnapshot,
 *     type PlaygroundSnapshot,
 *     SNAPSHOT_VERSION,
 *     MAX_ENCODED_LENGTH,
 * } from '@agenta/playground/snapshot'
 * ```
 */

// Schema exports
export {
    SNAPSHOT_VERSION,
    validateSnapshot,
    createEmptySnapshot,
    type PlaygroundSnapshot,
    type SelectionItem,
    type CommitSelectionItem,
    type DraftSelectionItem,
    type SnapshotDraftEntry,
    type ValidationResult,
} from "./snapshotSchema"

// Codec exports
export {
    MAX_ENCODED_LENGTH,
    WARN_ENCODED_LENGTH,
    encodeSnapshot,
    decodeSnapshot,
    parseSnapshot,
    checkEncodedSize,
    type EncodeResult,
    type DecodeResult,
} from "./snapshotCodec"
