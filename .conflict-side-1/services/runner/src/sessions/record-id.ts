import { createHash } from "node:crypto";

// RFC 4122 DNS namespace — the root the Python side also starts from (uuid.NAMESPACE_DNS).
const NAMESPACE_DNS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ""), "hex");
}

/**
 * RFC 4122 uuid5 (SHA-1) of `name` under `namespace`. SHA-1 is mandated by the uuid5 spec
 * itself (RFC 4122 §4.3), not a security choice: the output is a non-secret, non-collision-
 * sensitive identifier for record dedup, never used for auth, integrity, or secrecy.
 */
function uuid5(name: string, namespace: string): string {
  // codeql[js/weak-cryptographic-algorithm] SHA-1 is the RFC 4122 uuid5 algorithm; the
  // digest is a public, deterministic id, not a security-sensitive value.
  const hash = createHash("sha1")
    .update(uuidToBytes(namespace))
    .update(name, "utf8")
    .digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Project-wide root uuid5(NAMESPACE_DNS, "agenta"), sub-namespaced under "records" — the
// same construction the API uses for other domains (e.g. meters). Deriving a record's id as
// uuid5(this, key) makes it deterministic, so every streamed snapshot or retry within one
// execution maps to one id and upserts onto one row. Non-stable records
// send no id; the backend mints a uuid4 fallback.
const RECORD_NAMESPACE = uuid5("records", uuid5("agenta", NAMESPACE_DNS));

/**
 * Stable record id for a tool-family record, keyed on (session, tool-call id, type, turn).
 * The turn keeps later executions from overwriting prior history, while a retry within one
 * execution still upserts the same row.
 */
export function stableRecordId(
  sessionId: string,
  toolCallId: string,
  recordType: string,
  turnId?: string,
): string {
  return uuid5(
    `${sessionId}:${toolCallId}:${recordType}:${turnId ?? ""}`,
    RECORD_NAMESPACE,
  );
}
