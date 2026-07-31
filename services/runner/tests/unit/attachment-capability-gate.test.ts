import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { attachmentCapabilityGate } from "../../src/engines/sandbox_agent/attachments.ts";

const IMAGE_INPUT = {
  acpAgent: "claude",
  provider: "anthropic",
  capabilities: { images: true },
  modelCapabilities: { inputModalities: ["text", "image"] },
  mediaType: "image/png",
  byteLength: 1024,
};

describe("attachment capability gate", () => {
  it("delivers images natively through both pinned adapters", () => {
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
  });

  it("treats absent, empty, and unrecognized modalities as unknown", () => {
    for (const modelCapabilities of [
      undefined,
      { inputModalities: [] },
      { inputModalities: ["vision"] },
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

  it("keeps an oversized Claude image workspace-only", () => {
    assert.equal(
      attachmentCapabilityGate({
        ...IMAGE_INPUT,
        byteLength: Math.floor(7.5 * 1024 * 1024) + 1,
      }).reasonCode,
      "provider_inline_cap",
    );
  });

  it("keys the inline cap on provider, with ACP agent as the absent-provider fallback", () => {
    const byteLength = Math.floor(7.5 * 1024 * 1024) + 1;
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
