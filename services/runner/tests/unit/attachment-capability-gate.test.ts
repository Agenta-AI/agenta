import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  attachmentCapabilityGate,
  CLAUDE_INLINE_BASE64_MAX_BYTES,
  CODEX_INLINE_BASE64_MAX_BYTES,
} from "../../src/engines/sandbox_agent/attachments.ts";

// The gate compares the base64 expansion (4 bytes out per 3 in) against the cap, so derive the
// raw byte lengths that land either side of it.
const AT_CAP_BYTES = Math.floor((CLAUDE_INLINE_BASE64_MAX_BYTES / 4) * 3);
const OVER_CAP_BYTES = AT_CAP_BYTES + 3;
const CODEX_AT_CAP_BYTES = Math.floor((CODEX_INLINE_BASE64_MAX_BYTES / 4) * 3);
const CODEX_OVER_CAP_BYTES = CODEX_AT_CAP_BYTES + 3;

const IMAGE_INPUT = {
  acpAgent: "claude",
  provider: "anthropic",
  capabilities: { images: true },
  modelCapabilities: { inputModalities: ["text", "image"] },
  mediaType: "image/png",
  byteLength: 1024,
};

describe("attachment capability gate", () => {
  it("delivers images natively through all pinned adapters", () => {
    assert.equal(
      attachmentCapabilityGate(IMAGE_INPUT).outcome,
      "native",
    );
    assert.equal(
      attachmentCapabilityGate({
        ...IMAGE_INPUT,
        acpAgent: "pi",
        provider: "openai",
      }).outcome,
      "native",
    );
    assert.equal(
      attachmentCapabilityGate({
        ...IMAGE_INPUT,
        acpAgent: "codex",
        provider: "openai",
      }).outcome,
      "native",
    );
  });

  it("treats absent, empty, and unrecognized modalities as unknown", () => {
    for (const modelCapabilities of [
      undefined,
      { inputModalities: [] },
      { inputModalities: ["vision"] },
      // A malformed entry is not a declaration and must never read as one.
      { inputModalities: [{ kind: "image" } as unknown as string] },
    ]) {
      assert.deepEqual(
        attachmentCapabilityGate({
          ...IMAGE_INPUT,
          modelCapabilities,
        }),
        {
          outcome: "workspace_only",
          reasonCode: "model_modality_unknown",
          kind: "image",
        },
      );
    }
  });

  it("treats absence from a positive modality list as unknown", () => {
    assert.deepEqual(
      attachmentCapabilityGate({
        ...IMAGE_INPUT,
        modelCapabilities: { inputModalities: ["text"] },
      }),
      {
        outcome: "workspace_only",
        reasonCode: "model_modality_unknown",
        kind: "image",
      },
    );
  });

  it("never delivers audio or documents natively on the pinned adapters", () => {
    const audio = attachmentCapabilityGate({
      ...IMAGE_INPUT,
      mediaType: "audio/mpeg",
      modelCapabilities: { inputModalities: ["text", "audio"] },
    });
    assert.equal(audio.outcome, "workspace_only");
    assert.equal(audio.reasonCode, "transport_unsupported");
    assert.equal(
      attachmentCapabilityGate({
        ...IMAGE_INPUT,
        capabilities: { images: true, fileAttachments: true },
        mediaType: "application/pdf",
        modelCapabilities: {
          inputModalities: ["text", "documents"],
        },
      }).reasonCode,
      "adapter_unsupported",
    );
  });

  it("fails an explicit native request when transport did not advertise it", () => {
    assert.deepEqual(
      attachmentCapabilityGate({
        ...IMAGE_INPUT,
        capabilities: { images: false },
        requireNative: true,
      }),
      {
        outcome: "failed",
        reasonCode: "contract_violation",
        kind: "image",
        missing: "transport capability",
      },
    );
  });

  it("fails an explicit native request at the model layer too", () => {
    assert.deepEqual(
      attachmentCapabilityGate({
        ...IMAGE_INPUT,
        modelCapabilities: { inputModalities: ["text"] },
        requireNative: true,
      }),
      {
        outcome: "failed",
        reasonCode: "model_modality_unsupported",
        kind: "image",
      },
    );
  });

  it("keeps an oversized Claude image workspace-only and a just-under one native", () => {
    assert.equal(
      attachmentCapabilityGate({
        ...IMAGE_INPUT,
        byteLength: OVER_CAP_BYTES,
      }).reasonCode,
      "provider_inline_cap",
    );
    assert.equal(
      attachmentCapabilityGate({
        ...IMAGE_INPUT,
        byteLength: AT_CAP_BYTES,
      }).outcome,
      "native",
    );
  });

  it.each(["openai", "my-gateway", undefined])(
    "caps oversized Codex images independently of provider=%s",
    (provider) => {
      assert.equal(
        attachmentCapabilityGate({
          ...IMAGE_INPUT,
          acpAgent: "codex",
          provider,
          byteLength: CODEX_OVER_CAP_BYTES,
        }).reasonCode,
        "provider_inline_cap",
      );
    },
  );

  it("keeps an exact-boundary Codex image native", () => {
    assert.equal(
      attachmentCapabilityGate({
        ...IMAGE_INPUT,
        acpAgent: "codex",
        provider: "openai",
        byteLength: CODEX_AT_CAP_BYTES,
      }).outcome,
      "native",
    );
  });

  it("keys the inline cap on provider, with ACP agent as the absent-provider fallback", () => {
    const byteLength = OVER_CAP_BYTES;
    assert.equal(
      attachmentCapabilityGate({
        ...IMAGE_INPUT,
        provider: "openai",
        byteLength,
      }).outcome,
      "native",
    );
    assert.equal(
      attachmentCapabilityGate({
        ...IMAGE_INPUT,
        provider: undefined,
        byteLength,
      }).reasonCode,
      "provider_inline_cap",
    );
  });
});
