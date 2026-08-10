import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";

import {
  claimAttachments,
  fetchAttachment,
  filenameFromContentDisposition,
} from "../../src/sessions/attachments.ts";

const ATTACHMENT_ID = "019a52c2-14c0-7c14-b874-2f5798f9cd21";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("attachment API client", () => {
  it("returns null for a 404 instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("missing", { status: 404 })),
    );
    assert.equal(
      await fetchAttachment("session-1", ATTACHMENT_ID, () => "Bearer test"),
      null,
    );
  });

  it("returns null when the bounded request times out", async () => {
    vi.stubEnv("AGENTA_ATTACHMENTS_FETCH_TIMEOUT_MS", "1");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (_input: Parameters<typeof fetch>[0], init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            const abort = () => reject(new Error("aborted"));
            if (init?.signal?.aborted) abort();
            else init?.signal?.addEventListener("abort", abort, { once: true });
          }),
      ),
    );
    assert.equal(
      await fetchAttachment("session-1", ATTACHMENT_ID, () => "Bearer test"),
      null,
    );
  });

  it("uses verified headers and prefers RFC 5987 filename*", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: {
              "content-type": "image/png",
              "content-disposition":
                "attachment; filename=\"fallback.png\"; filename*=UTF-8''..%2Ff%C3%B6%C3%B6.png",
            },
          }),
      ),
    );

    const fetched = await fetchAttachment(
      "session-1",
      ATTACHMENT_ID,
      () => "Bearer test",
    );
    assert.deepEqual(fetched, {
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: "image/png",
      filename: "föö.png",
    });
  });

  it("returns null when a 200 response omits the verified headers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { "content-type": "image/png" },
          }),
      ),
    );
    assert.equal(
      await fetchAttachment("session-1", ATTACHMENT_ID, () => "Bearer test"),
      null,
    );
  });

  it("strips content-type parameters from the media type", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array([1]), {
            status: 200,
            headers: {
              "content-type": "IMAGE/PNG; charset=binary",
              "content-disposition": "attachment; filename=photo.png",
            },
          }),
      ),
    );
    const fetched = await fetchAttachment(
      "session-1",
      ATTACHMENT_ID,
      () => "Bearer test",
    );
    assert.equal(fetched?.mediaType, "image/png");
  });

  it("refuses a body that declares more than the per-attachment cap", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array([1]), {
            status: 200,
            headers: {
              "content-type": "image/png",
              "content-disposition": "attachment; filename=photo.png",
              "content-length": String(64 * 1024 * 1024),
            },
          }),
      ),
    );
    assert.equal(
      await fetchAttachment("session-1", ATTACHMENT_ID, () => "Bearer test"),
      null,
    );
  });

  it("parses quoted filename when filename* is absent", () => {
    assert.equal(
      filenameFromContentDisposition(
        'attachment; filename="folder\\\\report.pdf"',
      ),
      "report.pdf",
    );
  });

  it("stays linear on an unterminated quote full of escapes", () => {
    const hostile = `attachment; filename="${"\\!".repeat(50_000)}`;
    const started = performance.now();
    filenameFromContentDisposition(hostile);
    assert.ok(performance.now() - started < 1_000);
  });

  it("posts the exact claim contract with the run credential", async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        request = { url: String(input), init };
        return new Response("{}", { status: 200 });
      }),
    );

    assert.equal(
      await claimAttachments("session-1", [ATTACHMENT_ID], () => "Bearer test"),
      true,
    );
    assert.equal(
      request?.url.endsWith("/sessions/attachments/reference"),
      true,
    );
    assert.equal(request?.init?.method, "POST");
    assert.deepEqual(JSON.parse(String(request?.init?.body)), {
      session_id: "session-1",
      attachment_ids: [ATTACHMENT_ID],
    });
    assert.equal(
      (request?.init?.headers as Record<string, string>).authorization,
      "Bearer test",
    );
  });

  it("treats a claim failure as non-fatal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 503 })),
    );
    assert.equal(
      await claimAttachments("session-1", [ATTACHMENT_ID], () => "Bearer test"),
      false,
    );
  });
});
