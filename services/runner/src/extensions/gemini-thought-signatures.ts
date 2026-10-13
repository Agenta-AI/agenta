/**
 * Keep Gemini's thought signatures on Pi's OpenAI-compatible client.
 *
 * Gemini returns a `thought_signature` with each step's first function call and refuses the next
 * request when the history sends that call back without it ("HTTP 400: Function call is missing a
 * thought_signature"). On an OpenAI-compatible endpoint (Vertex's `endpoints/openapi`, Google's
 * `v1beta/openai`) the signature rides `tool_calls[N].extra_content.google.thought_signature`.
 * Pi's `openai-completions` client (0.99.1) neither reads nor writes `extra_content`, so every
 * Gemini tool loop on that path failed on its second model call.
 *
 * This keeps the round trip without patching Pi:
 *  1. `provider_stream_event` reads the signature off the raw chunks of the response in flight.
 *  2. `message_end` writes it onto the finished tool call's `thoughtSignature`, the field Pi's
 *     native Google clients use for the same value. Pi persists the message after this handler,
 *     so the signature survives a Pi restart, and Pi's own transform drops it on a model switch.
 *  3. `context` indexes the transcript's signed tool calls by id before each model call.
 *  4. `before_provider_request` puts each signature back on the matching tool call, for the same
 *     model only, since a signature is valid only for the model that produced it.
 *
 * A response without signatures (every non-Gemini model) leaves every step a no-op.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const OPENAI_COMPLETIONS_API = "openai-completions";

interface SignedToolCall {
  model: string;
  signature: string;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function geminiSignatureOf(toolCall: JsonRecord): string | undefined {
  const extra = toolCall.extra_content;
  const google = isRecord(extra) ? extra.google : undefined;
  const signature = isRecord(google) ? google.thought_signature : undefined;
  return typeof signature === "string" && signature ? signature : undefined;
}

/**
 * The signatures of one streamed response, one entry per tool call in the order the stream
 * opened them. Keyed by stream index, not id, because only the first delta of a call is sure to
 * carry its id. Pi builds its tool call blocks in the same order, so the n-th entry belongs to the
 * n-th tool call block of the finished message.
 */
export class StreamedSignatures {
  private readonly byIndex = new Map<number, string | undefined>();

  reset(): void {
    this.byIndex.clear();
  }

  /** Read one raw chat-completions chunk. */
  observe(chunk: unknown): void {
    if (!isRecord(chunk) || !Array.isArray(chunk.choices)) return;
    for (const choice of chunk.choices) {
      const delta = isRecord(choice) ? choice.delta : undefined;
      const toolCalls = isRecord(delta) ? delta.tool_calls : undefined;
      if (!Array.isArray(toolCalls)) continue;
      toolCalls.forEach((toolCall, position) => {
        if (!isRecord(toolCall)) return;
        const index =
          typeof toolCall.index === "number" ? toolCall.index : position;
        const signature = geminiSignatureOf(toolCall);
        if (signature) this.byIndex.set(index, signature);
        else if (!this.byIndex.has(index)) this.byIndex.set(index, undefined);
      });
    }
  }

  /** The signatures in tool call order; `undefined` where a call carried none. */
  inOrder(): Array<string | undefined> {
    return [...this.byIndex.values()];
  }
}

/**
 * The finished assistant message with each streamed signature on its tool call, or `undefined`
 * when there is nothing to add. A signature already on a block is left as it is.
 */
export function signFinishedMessage(
  message: unknown,
  signatures: Array<string | undefined>,
): JsonRecord | undefined {
  if (!isRecord(message) || message.role !== "assistant") return undefined;
  if (message.api !== OPENAI_COMPLETIONS_API) return undefined;
  if (!signatures.some(Boolean) || !Array.isArray(message.content))
    return undefined;
  let position = 0;
  let changed = false;
  const content = message.content.map((block) => {
    if (!isRecord(block) || block.type !== "toolCall") return block;
    const signature = signatures[position++];
    if (!signature || block.thoughtSignature) return block;
    changed = true;
    return { ...block, thoughtSignature: signature };
  });
  return changed ? { ...message, content } : undefined;
}

/** The signed tool calls of a transcript, by tool call id. */
export function indexSignedToolCalls(
  messages: unknown[],
): Map<string, SignedToolCall> {
  const index = new Map<string, SignedToolCall>();
  for (const message of messages) {
    if (!isRecord(message) || message.role !== "assistant") continue;
    if (message.api !== OPENAI_COMPLETIONS_API) continue;
    if (typeof message.model !== "string" || !Array.isArray(message.content))
      continue;
    for (const block of message.content) {
      if (!isRecord(block) || block.type !== "toolCall") continue;
      const { id, thoughtSignature } = block;
      if (typeof id !== "string" || !id) continue;
      if (typeof thoughtSignature !== "string" || !thoughtSignature) continue;
      index.set(id, { model: message.model, signature: thoughtSignature });
    }
  }
  return index;
}

/**
 * The request payload with each known signature back on its assistant tool call, or `undefined`
 * when nothing changes. A tool call that already carries `extra_content` is left as it is.
 */
export function attachSignatures(
  payload: unknown,
  signed: Map<string, SignedToolCall>,
): JsonRecord | undefined {
  if (signed.size === 0 || !isRecord(payload)) return undefined;
  const { model, messages } = payload;
  if (typeof model !== "string" || !Array.isArray(messages)) return undefined;
  let changed = false;
  const nextMessages = messages.map((message) => {
    if (!isRecord(message) || message.role !== "assistant") return message;
    if (!Array.isArray(message.tool_calls)) return message;
    let messageChanged = false;
    const toolCalls = message.tool_calls.map((toolCall) => {
      if (!isRecord(toolCall) || toolCall.extra_content !== undefined)
        return toolCall;
      const known =
        typeof toolCall.id === "string" ? signed.get(toolCall.id) : undefined;
      if (!known || known.model !== model) return toolCall;
      messageChanged = true;
      return {
        ...toolCall,
        extra_content: { google: { thought_signature: known.signature } },
      };
    });
    if (!messageChanged) return message;
    changed = true;
    return { ...message, tool_calls: toolCalls };
  });
  return changed ? { ...payload, messages: nextMessages } : undefined;
}

export function registerGeminiThoughtSignatures(pi: ExtensionAPI): void {
  const streamed = new StreamedSignatures();
  let signed = new Map<string, SignedToolCall>();

  pi.on("context", async (event) => {
    signed = indexSignedToolCalls(event.messages);
  });

  pi.on("before_provider_request", async (event) => {
    // A new request, or a retry of a failed one, starts a new response.
    streamed.reset();
    return attachSignatures(event.payload, signed);
  });

  pi.on("provider_stream_event", async (event) => {
    if (event.api === OPENAI_COMPLETIONS_API) streamed.observe(event.data);
  });

  pi.on("message_end", async (event) => {
    const message = signFinishedMessage(event.message, streamed.inOrder());
    if (event.message.role === "assistant") streamed.reset();
    return message ? { message: message as typeof event.message } : undefined;
  });
}
