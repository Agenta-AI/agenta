import { describe, expect, it } from "vitest";
import {
  attachSignatures,
  indexSignedToolCalls,
  registerGeminiThoughtSignatures,
  signFinishedMessage,
  StreamedSignatures,
} from "../../src/extensions/gemini-thought-signatures.ts";

const chunk = (toolCalls: unknown[]) => ({
  choices: [{ index: 0, delta: { tool_calls: toolCalls } }],
});
const signedCall = (signature: string) => ({
  extra_content: { google: { thought_signature: signature } },
});

const assistant = (
  content: unknown[],
  overrides: Record<string, unknown> = {},
) => ({
  role: "assistant",
  api: "openai-completions",
  provider: "vertex",
  model: "google/gemini-3.7-flash",
  content,
  ...overrides,
});
const toolCall = (id: string, extra: Record<string, unknown> = {}) => ({
  type: "toolCall",
  id,
  name: "bash",
  arguments: {},
  ...extra,
});

describe("StreamedSignatures", () => {
  it("keeps one entry per tool call in stream order, even when the signature comes in a later delta", () => {
    const streamed = new StreamedSignatures();
    streamed.observe(
      chunk([{ index: 0, id: "a", function: { name: "bash", arguments: "" } }]),
    );
    streamed.observe(
      chunk([
        { index: 0, function: { arguments: "{}" }, ...signedCall("sig-a") },
      ]),
    );
    // Gemini signs only the first of parallel calls.
    streamed.observe(
      chunk([
        { index: 1, id: "b", function: { name: "read", arguments: "{}" } },
      ]),
    );
    expect(streamed.inOrder()).toEqual(["sig-a", undefined]);
    streamed.reset();
    expect(streamed.inOrder()).toEqual([]);
  });

  it("ignores chunks without tool calls", () => {
    const streamed = new StreamedSignatures();
    streamed.observe({ choices: [{ index: 0, delta: { content: "hi" } }] });
    streamed.observe({ candidates: [] });
    streamed.observe(undefined);
    expect(streamed.inOrder()).toEqual([]);
  });
});

describe("signFinishedMessage", () => {
  it("puts each signature on the tool call at the same position", () => {
    const message = assistant([
      { type: "text", text: "x" },
      toolCall("a"),
      toolCall("b"),
    ]);
    expect(signFinishedMessage(message, ["sig-a", undefined])?.content).toEqual(
      [
        { type: "text", text: "x" },
        toolCall("a", { thoughtSignature: "sig-a" }),
        toolCall("b"),
      ],
    );
  });

  it("changes nothing without a signature, on another API, or where a signature is already set", () => {
    expect(
      signFinishedMessage(assistant([toolCall("a")]), [undefined]),
    ).toBeUndefined();
    expect(
      signFinishedMessage(
        assistant([toolCall("a")], { api: "google-vertex" }),
        ["sig"],
      ),
    ).toBeUndefined();
    expect(
      signFinishedMessage(
        assistant([toolCall("a", { thoughtSignature: "own" })]),
        ["sig"],
      ),
    ).toBeUndefined();
    expect(
      signFinishedMessage({ role: "user", content: [] }, ["sig"]),
    ).toBeUndefined();
  });
});

describe("attachSignatures", () => {
  const signed = indexSignedToolCalls([
    assistant([toolCall("a", { thoughtSignature: "sig-a" }), toolCall("b")]),
    assistant([toolCall("c", { thoughtSignature: "sig-c" })], {
      model: "google/gemini-3.8-flash",
    }),
    assistant([toolCall("d", { thoughtSignature: "{}" })], {
      api: "openai-responses",
    }),
  ]);
  const payload = (calls: unknown[]) => ({
    model: "google/gemini-3.7-flash",
    messages: [
      { role: "user", content: "hi" },
      { role: "assistant", content: null, tool_calls: calls },
    ],
  });
  const call = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    type: "function",
    function: { name: "bash", arguments: "{}" },
    ...extra,
  });

  it("indexes only signed calls the OpenAI-compatible client made", () => {
    expect([...signed.keys()]).toEqual(["a", "c"]);
  });

  it("puts the signature back on the matching call", () => {
    const next = attachSignatures(payload([call("a"), call("b")]), signed);
    expect(next?.messages).toEqual([
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: null,
        tool_calls: [call("a", signedCall("sig-a")), call("b")],
      },
    ]);
  });

  it("never sends a signature to a model other than the one that produced it", () => {
    expect(attachSignatures(payload([call("c")]), signed)).toBeUndefined();
  });

  it("leaves a call that already carries extra_content, and a payload with nothing to add", () => {
    expect(
      attachSignatures(payload([call("a", signedCall("kept"))]), signed),
    ).toBeUndefined();
    expect(attachSignatures(payload([call("z")]), signed)).toBeUndefined();
    expect(attachSignatures({ input: [] }, signed)).toBeUndefined();
  });
});

describe("registerGeminiThoughtSignatures", () => {
  type Handler = (event: any) => Promise<unknown>;

  function fakePi() {
    const handlers = new Map<string, Handler>();
    const pi = {
      on: (name: string, handler: Handler) => handlers.set(name, handler),
    };
    registerGeminiThoughtSignatures(pi as never);
    return (name: string, event: Record<string, unknown>) =>
      handlers.get(name)!({ type: name, ...event });
  }

  it("carries a streamed signature from the response to the next request", async () => {
    const emit = fakePi();
    await emit("context", { messages: [] });
    expect(
      await emit("before_provider_request", {
        payload: { model: "google/gemini-3.7-flash", messages: [] },
      }),
    ).toBeUndefined();
    await emit("provider_stream_event", {
      api: "openai-completions",
      data: chunk([{ index: 0, id: "a", ...signedCall("sig-a") }]),
    });
    const finished = (await emit("message_end", {
      message: assistant([toolCall("a")]),
    })) as { message: { content: unknown[] } };
    expect(finished.message.content).toEqual([
      toolCall("a", { thoughtSignature: "sig-a" }),
    ]);

    await emit("context", { messages: [finished.message] });
    const next = (await emit("before_provider_request", {
      payload: {
        model: "google/gemini-3.7-flash",
        messages: [
          { role: "assistant", tool_calls: [{ id: "a", type: "function" }] },
        ],
      },
    })) as { messages: Array<{ tool_calls: unknown[] }> };
    expect(next.messages[0]!.tool_calls).toEqual([
      { id: "a", type: "function", ...signedCall("sig-a") },
    ]);
  });

  it("drops a failed attempt's signatures when the request is retried", async () => {
    const emit = fakePi();
    await emit("before_provider_request", { payload: {} });
    await emit("provider_stream_event", {
      api: "openai-completions",
      data: chunk([{ index: 0, id: "a", ...signedCall("stale") }]),
    });
    await emit("before_provider_request", { payload: {} });
    expect(
      await emit("message_end", { message: assistant([toolCall("b")]) }),
    ).toBeUndefined();
  });

  it("reads no stream of another API", async () => {
    const emit = fakePi();
    await emit("provider_stream_event", {
      api: "google-vertex",
      data: chunk([{ index: 0, id: "a", ...signedCall("sig") }]),
    });
    expect(
      await emit("message_end", { message: assistant([toolCall("a")]) }),
    ).toBeUndefined();
  });
});
