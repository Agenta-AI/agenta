import { randomUUID } from "node:crypto";
import {
  lstatSync,
  linkSync,
  mkdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { posix, resolve, sep } from "node:path";

import { envInt, envTimerMs } from "../../env.ts";
import {
  currentUserTurn,
  isLegacyInlineImageBlock,
  type AgentRunRequest,
  type AttachmentRef,
  type ChatMessage,
  type ContentBlock,
  type HarnessCapabilities,
} from "../../protocol.ts";
import {
  fetchAttachment,
  type FetchedAttachment,
} from "../../sessions/attachments.ts";
import { attachmentDeliveryUnsupportedMessage } from "./capabilities.ts";
import type { RunPlan, RunPlanWorkspace } from "./run-plan.ts";
import { COLD_FRAME_USER_LABEL } from "./transcript.ts";

export type AttachmentDeliveryOutcome =
  | "native"
  | "workspace_only"
  | "failed";

export type AttachmentDeliveryReasonCode =
  | "transport_unsupported"
  | "adapter_unsupported"
  | "model_modality_unknown"
  | "model_modality_unsupported"
  | "provider_inline_cap"
  | "fetch_failed"
  | "materialize_failed"
  | "contract_violation"
  | "native_supported";

export interface AttachmentPath {
  root: string;
  directory: string;
  absolute: string;
  relative: string;
}

export interface AttachmentGate {
  outcome: AttachmentDeliveryOutcome;
  reasonCode: AttachmentDeliveryReasonCode;
  kind: "image" | "audio" | "document";
  missing?: string;
}

export interface ResolvedAttachment {
  ref: AttachmentRef;
  bytes?: Uint8Array;
  path?: AttachmentPath;
  gate: AttachmentGate;
}

export interface InlineImage {
  data: string;
  mimeType: string;
}

export type AcpPromptBlock =
  | { type: "image"; data: string; mimeType: string }
  | { type: "text"; text: string };

export interface AttachmentSandbox {
  statFs?: (query: { path: string }) => Promise<unknown>;
  mkdirFs?: (query: { path: string }) => Promise<unknown>;
  writeFsFile?: (query: { path: string }, body: Uint8Array) => Promise<unknown>;
  runProcess?: (query: {
    command: string;
    args: string[];
    timeoutMs?: number;
  }) => Promise<{ exitCode?: number } | undefined>;
}

type MaterializePlan = Pick<RunPlan, "isDaytona"> & {
  workspace: Pick<RunPlanWorkspace, "cwd">;
};
type DeliveryPlan = MaterializePlan & Pick<RunPlan, "acpAgent" | "harness">;
type Auth = () => string;
type Log = (message: string) => void;

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const NATIVE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
export const CLAUDE_INLINE_BASE64_MAX_BYTES = 10 * 1024 * 1024;
export const CODEX_INLINE_BASE64_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_RESTORE_CONCURRENCY = 4;
const DEFAULT_RESTORE_TIMEOUT_MS = 15_000;

// Adapter fidelity at the pinned versions: claude-agent-acp 0.58.1, codex-acp 1.1.7, and
// pi-acp 0.0.29.
const ADAPTER_NATIVE_SUPPORT = {
  claude: { image: true, audio: false, document: false },
  codex: { image: true, audio: false, document: false },
  pi: { image: true, audio: false, document: false },
} as const;

function attachmentLog(message: string): void {
  process.stderr.write("[attachments] " + message + "\n");
}

export function attachmentRestoreConcurrency(): number {
  return envInt(
    "AGENTA_ATTACHMENTS_RESTORE_CONCURRENCY",
    DEFAULT_RESTORE_CONCURRENCY,
    { min: 1, max: 32, log: attachmentLog },
  );
}

export function attachmentRestoreTimeoutMs(): number {
  return envTimerMs(
    "AGENTA_ATTACHMENTS_RESTORE_TIMEOUT_MS",
    DEFAULT_RESTORE_TIMEOUT_MS,
    { min: 1, log: attachmentLog },
  );
}

export function assertCanonicalAttachmentId(attachmentId: string): void {
  if (!CANONICAL_UUID.test(attachmentId)) {
    throw new Error("attachment id must be a canonical UUID");
  }
}

function validatedFilename(ref: AttachmentRef): string {
  const filename = ref.filename;
  if (
    typeof filename !== "string" ||
    filename.length === 0 ||
    filename === "." ||
    filename === ".." ||
    filename.includes("/") ||
    filename.includes("\\") ||
    CONTROL_CHARACTER.test(filename)
  ) {
    throw new Error("attachment filename must be a safe basename");
  }
  return filename;
}

export function collectAttachmentRefs(
  message: ChatMessage | null,
): AttachmentRef[] {
  if (!message) return [];
  // Attachment refs deliberately belong only to user messages, so reuse currentUserTurn to
  // enforce that role coupling. Current-turn delivery replaces wire display fields from the API;
  // transcript replay may reuse fields from records the runner previously wrote.
  return currentUserTurn({ messages: [message] }).attachments;
}

function parseDataUri(uri: string): InlineImage | null {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(uri);
  if (!match) return null;
  const mimeType = match[1] || "image/png";
  try {
    const data = match[2]
      ? match[3].replace(/\s/g, "")
      : Buffer.from(decodeURIComponent(match[3]), "utf8").toString("base64");
    return data ? { data, mimeType } : null;
  } catch {
    return null;
  }
}

export function collectLegacyInlineImages(
  message: ChatMessage | null,
): InlineImage[] {
  if (!message || !Array.isArray(message.content)) return [];
  const images: InlineImage[] = [];
  for (const block of message.content) {
    if (!isLegacyInlineImageBlock(block)) continue;
    if (typeof block.uri === "string" && block.uri.startsWith("data:")) {
      const parsed = parseDataUri(block.uri);
      if (parsed) {
        images.push(parsed);
        continue;
      }
    }
    if (typeof block.data === "string" && block.data.length > 0) {
      const parsed = block.data.startsWith("data:")
        ? parseDataUri(block.data)
        : {
            data: block.data,
            mimeType:
              typeof block.mimeType === "string"
                ? block.mimeType
                : "image/png",
          };
      if (parsed) images.push(parsed);
    }
  }
  return images;
}

export function validateRef(
  ref: AttachmentRef,
): asserts ref is AttachmentRef & { filename: string } {
  assertCanonicalAttachmentId(ref.attachmentId);
  validatedFilename(ref);
}

export function relativeAttachmentPath(ref: AttachmentRef): string {
  validateRef(ref);
  return posix.join("attachments", ref.attachmentId, ref.filename);
}

export function attachmentWorkingPath(
  cwd: string,
  ref: AttachmentRef,
): AttachmentPath {
  validateRef(ref);
  const filename = ref.filename;
  const root = resolve(cwd, "attachments");
  const directory = resolve(root, ref.attachmentId);
  const absolute = resolve(directory, filename);
  const prefix = root.endsWith(sep) ? root : root + sep;
  if (!directory.startsWith(prefix) || !absolute.startsWith(prefix)) {
    throw new Error("attachment path escapes the attachments directory");
  }
  return {
    root,
    directory,
    absolute,
    relative: relativeAttachmentPath(ref),
  };
}

export function attachmentMention(ref: AttachmentRef): string {
  validateRef(ref);
  return (
    "[attached file: " +
    ref.filename +
    " at " +
    relativeAttachmentPath(ref) +
    "]"
  );
}

export function unavailableAttachmentMention(ref: AttachmentRef): string {
  let filename = "attachment";
  try {
    filename = validatedFilename(ref);
  } catch {
    // A missing fetch leaves no authoritative filename. Do not render an unsafe wire value.
  }
  return "[attached file: " + filename + " - no longer available]";
}

function fileSystemError(error: unknown): NodeJS.ErrnoException {
  return error as NodeJS.ErrnoException;
}

function safeUnlink(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if (fileSystemError(error).code !== "ENOENT") throw error;
  }
}

function rejectLocalSymlinks(paths: readonly string[]): void {
  for (const path of paths) {
    try {
      if (lstatSync(path).isSymbolicLink()) {
        throw new Error("attachment path contains a symbolic link");
      }
    } catch (error) {
      if (fileSystemError(error).code === "ENOENT") continue;
      throw error;
    }
  }
}

function localMaterialize(
  path: AttachmentPath,
  bytes: Uint8Array,
): "written" | "exists" {
  mkdirSync(path.root, { recursive: true });
  rejectLocalSymlinks([path.root]);
  try {
    mkdirSync(path.directory);
  } catch (error) {
    if (fileSystemError(error).code !== "EEXIST") throw error;
  }
  rejectLocalSymlinks([path.root, path.directory, path.absolute]);

  const temporary = path.absolute + "." + randomUUID() + ".tmp";
  let temporaryExists = false;
  try {
    writeFileSync(temporary, Buffer.from(bytes), { flag: "wx" });
    temporaryExists = true;
    try {
      linkSync(temporary, path.absolute);
      return "written";
    } catch (error) {
      const code = fileSystemError(error).code;
      if (code === "EEXIST") return "exists";
      if (
        code !== "EPERM" &&
        code !== "ENOSYS" &&
        code !== "EOPNOTSUPP"
      ) {
        throw error;
      }

      safeUnlink(temporary);
      temporaryExists = false;
      try {
        writeFileSync(path.absolute, Buffer.from(bytes), { flag: "wx" });
        return "written";
      } catch (fallbackError) {
        if (fileSystemError(fallbackError).code === "EEXIST") {
          return "exists";
        }
        throw fallbackError;
      }
    }
  } finally {
    if (temporaryExists) safeUnlink(temporary);
  }
}

async function rejectDaytonaSymlinks(
  sandbox: AttachmentSandbox,
  paths: readonly string[],
): Promise<void> {
  if (typeof sandbox.runProcess !== "function") {
    throw new Error("Daytona sandbox cannot verify attachment path components");
  }
  for (const path of paths) {
    const result = await sandbox.runProcess({
      command: "test",
      args: ["-L", path],
      timeoutMs: 15_000,
    });
    // A missing exit code means the check never ran, which is not evidence that the path is
    // safe. Fail closed rather than materializing through an unverified component.
    if (typeof result?.exitCode !== "number") {
      throw new Error(
        "sandbox did not report an exit code for the symlink check",
      );
    }
    if (result.exitCode === 0) {
      throw new Error("attachment path contains a symbolic link");
    }
  }
}

async function daytonaMaterialize(
  sandbox: AttachmentSandbox,
  path: AttachmentPath,
  bytes: Uint8Array,
): Promise<"written" | "exists"> {
  if (
    typeof sandbox.mkdirFs !== "function" ||
    typeof sandbox.statFs !== "function" ||
    typeof sandbox.writeFsFile !== "function"
  ) {
    throw new Error("Daytona sandbox lacks attachment filesystem operations");
  }
  await rejectDaytonaSymlinks(sandbox, [
    path.root,
    path.directory,
    path.absolute,
  ]);
  await sandbox.mkdirFs({ path: path.directory });

  // Daytona has no exclusive create; this check-then-write race is accepted.
  try {
    await sandbox.statFs({ path: path.absolute });
    return "exists";
  } catch {}

  await sandbox.writeFsFile(
    { path: path.absolute },
    Buffer.from(bytes),
  );
  return "written";
}

export async function materializeWorkingCopy(
  sandbox: AttachmentSandbox,
  plan: MaterializePlan,
  ref: AttachmentRef,
  bytes: Uint8Array,
): Promise<"written" | "exists"> {
  const path = attachmentWorkingPath(plan.workspace.cwd, ref);
  return plan.isDaytona
    ? daytonaMaterialize(sandbox, path, bytes)
    : localMaterialize(path, bytes);
}

function mediaBase(mediaType: string | undefined): string {
  return String(mediaType ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
}

export function attachmentKind(
  mediaType: string | undefined,
): "image" | "audio" | "document" {
  const base = mediaBase(mediaType);
  if (NATIVE_IMAGE_TYPES.has(base)) return "image";
  if (base.startsWith("audio/")) return "audio";
  return "document";
}

function transportSupports(
  kind: AttachmentGate["kind"],
  capabilities: HarnessCapabilities,
): boolean {
  if (kind === "image") return capabilities.images === true;
  if (kind === "document") return capabilities.fileAttachments === true;
  return false;
}

function adapterSupports(
  acpAgent: string,
  kind: AttachmentGate["kind"],
): boolean {
  const adapter =
    ADAPTER_NATIVE_SUPPORT[
      acpAgent as keyof typeof ADAPTER_NATIVE_SUPPORT
    ];
  return adapter?.[kind] === true;
}

// The catalog declares modalities as bare tokens ("text", "image"). Only tokens listed here
// count as a declaration; anything else stays unrecognized, so a malformed or future value can
// never read as a supported modality.
const MODALITY_TOKENS: Record<string, AttachmentGate["kind"]> = {
  image: "image",
  images: "image",
  audio: "audio",
  document: "document",
  documents: "document",
};

function modelModalityState(
  modalities: string[] | undefined,
  kind: AttachmentGate["kind"],
): "supported" | "unknown" {
  if (!Array.isArray(modalities) || modalities.length === 0) {
    return "unknown";
  }
  const supported = modalities.some(
    (value) =>
      typeof value === "string" &&
      MODALITY_TOKENS[value.trim().toLowerCase()] === kind,
  );
  // Catalog modality lists are positive declarations, so absence is not a negative capability.
  return supported ? "supported" : "unknown";
}

function base64Length(byteLength: number): number {
  return Math.ceil(byteLength / 3) * 4;
}

export function attachmentCapabilityGate(input: {
  acpAgent: string;
  provider?: string;
  capabilities: HarnessCapabilities;
  modelCapabilities?: AgentRunRequest["modelCapabilities"];
  mediaType: string;
  byteLength: number;
  requireNative?: boolean;
}): AttachmentGate {
  const kind = attachmentKind(input.mediaType);
  if (!transportSupports(kind, input.capabilities)) {
    if (input.requireNative) {
      return {
        outcome: "failed",
        reasonCode: "contract_violation",
        kind,
        missing: "transport capability",
      };
    }
    return {
      outcome: "workspace_only",
      reasonCode: "transport_unsupported",
      kind,
    };
  }

  // `requireNative` means the caller cannot degrade to a workspace copy, so every layer that
  // withholds native delivery is a failure for it, not a downgrade.
  if (!adapterSupports(input.acpAgent, kind)) {
    return {
      outcome: input.requireNative ? "failed" : "workspace_only",
      reasonCode: "adapter_unsupported",
      kind,
    };
  }

  const modelState = modelModalityState(
    input.modelCapabilities?.inputModalities,
    kind,
  );
  if (modelState === "unknown") {
    return input.requireNative
      ? {
          outcome: "failed",
          reasonCode: "model_modality_unsupported",
          kind,
        }
      : {
          outcome: "workspace_only",
          reasonCode: "model_modality_unknown",
          kind,
        };
  }

  const provider = input.provider?.trim().toLowerCase();
  // Older callers omit provider, so retain the ACP-agent heuristic only as that fallback.
  const usesAnthropicInlineLimit = provider
    ? provider === "anthropic"
    : input.acpAgent === "claude";
  // codex-acp expands every ACP image into an inline data URL, regardless of model provider.
  // Bound that request growth without changing the existing Pi/OpenAI delivery policy.
  const inlineBase64Limit = usesAnthropicInlineLimit
    ? CLAUDE_INLINE_BASE64_MAX_BYTES
    : input.acpAgent === "codex"
      ? CODEX_INLINE_BASE64_MAX_BYTES
      : null;
  if (
    kind === "image" &&
    inlineBase64Limit !== null &&
    base64Length(input.byteLength) > inlineBase64Limit
  ) {
    return {
      outcome: "workspace_only",
      reasonCode: "provider_inline_cap",
      kind,
    };
  }

  return { outcome: "native", reasonCode: "native_supported", kind };
}

export function buildPromptBlocks(
  turnText: string,
  resolved: readonly ResolvedAttachment[],
  legacyImages: readonly InlineImage[] = [],
  latestUserText: string = turnText,
): AcpPromptBlock[] {
  const blocks: AcpPromptBlock[] = [];
  for (const attachment of resolved) {
    if (
      attachment.gate.outcome === "native" &&
      attachment.gate.kind === "image" &&
      attachment.bytes
    ) {
      blocks.push({
        type: "image",
        data: Buffer.from(attachment.bytes).toString("base64"),
        mimeType: mediaBase(attachment.ref.mediaType),
      });
    }
  }
  for (const image of legacyImages) {
    blocks.push({ type: "image", data: image.data, mimeType: image.mimeType });
  }

  const mentions = resolved.map((attachment) =>
    attachment.gate.outcome === "failed"
      ? unavailableAttachmentMention(attachment.ref)
      : attachmentMention(attachment.ref),
  );
  let text = turnText;
  if (mentions.length > 0) {
    const renderedMentions = mentions.join("\n");
    if (latestUserText && turnText.endsWith(latestUserText)) {
      text =
        turnText.slice(0, -latestUserText.length) +
        renderedMentions +
        "\n" +
        latestUserText;
    } else if (!latestUserText && turnText.endsWith(COLD_FRAME_USER_LABEL)) {
      text = turnText + renderedMentions;
    } else {
      text = [renderedMentions, turnText].filter(Boolean).join("\n");
    }
  }
  if (text) blocks.push({ type: "text", text });
  return blocks;
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("attachment restore timed out")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function verifiedRef(
  ref: AttachmentRef,
  fetched: FetchedAttachment,
): AttachmentRef {
  return {
    attachmentId: ref.attachmentId,
    filename: fetched.filename,
    mediaType: fetched.mediaType,
    size: fetched.bytes.byteLength,
  };
}

async function workingCopyExists(
  sandbox: AttachmentSandbox,
  plan: MaterializePlan,
  ref: AttachmentRef,
): Promise<boolean> {
  const path = attachmentWorkingPath(plan.workspace.cwd, ref);
  if (plan.isDaytona) {
    if (typeof sandbox.statFs !== "function") return false;
    await rejectDaytonaSymlinks(sandbox, [
      path.root,
      path.directory,
      path.absolute,
    ]);
    try {
      await sandbox.statFs({ path: path.absolute });
      return true;
    } catch {
      return false;
    }
  }

  rejectLocalSymlinks([path.root, path.directory, path.absolute]);
  try {
    lstatSync(path.absolute);
    return true;
  } catch (error) {
    if (fileSystemError(error).code === "ENOENT") return false;
    throw error;
  }
}

export async function restoreReferencedWorkingCopies(
  sandbox: AttachmentSandbox,
  plan: MaterializePlan,
  messages: readonly ChatMessage[],
  sessionId: string,
  auth: Auth,
  options: {
    concurrency?: number;
    timeoutMs?: number;
    log?: Log;
  } = {},
): Promise<ChatMessage[]> {
  const refs = messages.flatMap((message) => collectAttachmentRefs(message));
  if (refs.length === 0) return [...messages];

  const unique = new Map<string, AttachmentRef>();
  for (const ref of refs) unique.set(ref.attachmentId, ref);
  const pending = [...unique.values()];
  const resolved = new Map<string, AttachmentRef>();
  const failed = new Map<string, AttachmentRef>();
  const concurrency = options.concurrency ?? attachmentRestoreConcurrency();
  const timeoutMs = options.timeoutMs ?? attachmentRestoreTimeoutMs();
  const log = options.log ?? (() => {});

  const worker = async (): Promise<void> => {
    while (pending.length > 0) {
      const ref = pending.shift();
      if (!ref) return;
      try {
        await withTimeout(
          (async () => {
            assertCanonicalAttachmentId(ref.attachmentId);
            let recordPathIsUsable = true;
            try {
              validatedFilename(ref);
            } catch {
              recordPathIsUsable = false;
            }
            if (
              recordPathIsUsable &&
              (await workingCopyExists(sandbox, plan, ref))
            ) {
              // Historical refs come from runner-written durable records. Once their working copy
              // exists, those record-sourced display fields are sufficient and no download is due.
              resolved.set(ref.attachmentId, ref);
              return;
            }
            const fetched = await fetchAttachment(
              sessionId,
              ref.attachmentId,
              auth,
            );
            if (!fetched) {
              throw new Error("attachment content is no longer available");
            }
            const authoritative = verifiedRef(ref, fetched);
            await materializeWorkingCopy(
              sandbox,
              plan,
              authoritative,
              fetched.bytes,
            );
            resolved.set(ref.attachmentId, authoritative);
          })(),
          timeoutMs,
        );
      } catch (error) {
        failed.set(ref.attachmentId, ref);
        log(
          `attachment restore FAILED attachment=${ref.attachmentId}: ` +
            String(error instanceof Error ? error.message : error).slice(
              0,
              120,
            ),
        );
      }
    }
  };

  await Promise.allSettled(
    Array.from(
      { length: Math.min(concurrency, pending.length) },
      () => worker(),
    ),
  );

  return messages.map((message) => {
    if (!Array.isArray(message.content)) return message;
    return {
      ...message,
      content: message.content.map((block) => {
        if (
          block?.type !== "attachment" ||
          typeof block.attachmentId !== "string"
        ) {
          return block;
        }
        const authoritative = resolved.get(block.attachmentId);
        if (authoritative) {
          return {
            ...block,
            attachmentId: authoritative.attachmentId,
            filename: authoritative.filename,
            mimeType: authoritative.mediaType,
            size: authoritative.size,
          };
        }
        const unavailable = failed.get(block.attachmentId);
        return unavailable
          ? { type: "text", text: unavailableAttachmentMention(unavailable) }
          : block;
      }),
    };
  });
}

export async function resolveCurrentTurnAttachments(input: {
  message: ChatMessage | null;
  sessionId: string;
  auth: Auth;
  sandbox: AttachmentSandbox;
  plan: DeliveryPlan;
  capabilities: HarnessCapabilities;
  modelCapabilities?: AgentRunRequest["modelCapabilities"];
  provider?: string;
  emit: (event: {
    type: "attachment_delivery";
    attachmentId: string;
    outcome: AttachmentDeliveryOutcome;
    reasonCode: string;
    workingPath?: string;
  }) => void;
}): Promise<ResolvedAttachment[]> {
  const refs = collectAttachmentRefs(input.message);
  const resolved: ResolvedAttachment[] = [];
  let failure: Error | null = null;
  for (const ref of refs) {
    try {
      assertCanonicalAttachmentId(ref.attachmentId);
    } catch {
      input.emit({
        type: "attachment_delivery",
        attachmentId: ref.attachmentId,
        outcome: "failed",
        reasonCode: "contract_violation",
      });
      failure ??= new Error("Attachment reference is invalid.");
      continue;
    }

    const fetched = await fetchAttachment(
      input.sessionId,
      ref.attachmentId,
      input.auth,
    );
    if (!fetched) {
      input.emit({
        type: "attachment_delivery",
        attachmentId: ref.attachmentId,
        outcome: "failed",
        reasonCode: "fetch_failed",
      });
      resolved.push({
        ref,
        gate: {
          outcome: "failed",
          reasonCode: "fetch_failed",
          kind: attachmentKind(ref.mediaType),
        },
      });
      continue;
    }

    const authoritative = verifiedRef(ref, fetched);
    let path: AttachmentPath;
    try {
      path = attachmentWorkingPath(input.plan.workspace.cwd, authoritative);
      await materializeWorkingCopy(
        input.sandbox,
        input.plan,
        authoritative,
        fetched.bytes,
      );
    } catch {
      input.emit({
        type: "attachment_delivery",
        attachmentId: ref.attachmentId,
        outcome: "failed",
        reasonCode: "materialize_failed",
      });
      resolved.push({
        ref: authoritative,
        gate: {
          outcome: "failed",
          reasonCode: "materialize_failed",
          kind: attachmentKind(authoritative.mediaType),
        },
      });
      continue;
    }

    const gate = attachmentCapabilityGate({
      acpAgent: input.plan.acpAgent,
      provider: input.provider,
      capabilities: input.capabilities,
      modelCapabilities: input.modelCapabilities,
      mediaType: authoritative.mediaType ?? "",
      byteLength: fetched.bytes.byteLength,
    });
    if (gate.outcome === "failed") {
      input.emit({
        type: "attachment_delivery",
        attachmentId: ref.attachmentId,
        outcome: "failed",
        reasonCode: gate.reasonCode,
        workingPath: path.relative,
      });
      failure ??= new Error(
        attachmentDeliveryUnsupportedMessage(
          input.plan.harness,
          gate.kind,
          gate.missing ?? "required capability",
        ),
      );
      continue;
    }

    input.emit({
      type: "attachment_delivery",
      attachmentId: ref.attachmentId,
      outcome: gate.outcome,
      reasonCode: gate.reasonCode,
      workingPath: path.relative,
    });
    resolved.push({
      ref: authoritative,
      bytes: fetched.bytes,
      path,
      gate,
    });
  }
  if (failure) throw failure;
  return resolved;
}
