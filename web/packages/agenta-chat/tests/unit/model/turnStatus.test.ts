import type {UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import {
    deriveTurnStatus,
    readableTraceError,
    sanitizeErrorText,
} from "../../../src/model/turnStatus"
import reasoningOnlyTurnFixture from "../fixtures/reasoningOnlyTurn.json"

describe("deriveTurnStatus", () => {
    it("marks a reasoning-only settled turn as content-bearing but answer-less", () => {
        const [message] = reasoningOnlyTurnFixture as UIMessage[]
        const status = deriveTurnStatus(message, {isUser: false, isStreaming: false})
        expect(status.hasAnswer).toBe(false)
        expect(status.hasReasoning).toBe(true)
        expect(status.hasContent).toBe(true)
        expect(status.noResponse).toBe(true)
    })

    it("counts a server notice as the turn's answer", () => {
        // Without this the turn is answer-less, which makes it a "no response" turn: the
        // desktop then renders the bubble as a failure and, after another empty turn, drops
        // the row entirely — losing the one sentence that says what to do.
        const message = {
            id: "a1",
            role: "assistant",
            parts: [{type: "data-mcp-server-failed", data: {serverName: "mock-mcp"}}],
        } as unknown as UIMessage
        const status = deriveTurnStatus(message, {isUser: false, isStreaming: false})
        expect(status.hasAnswer).toBe(true)
        expect(status.hasContent).toBe(true)
        expect(status.noResponse).toBe(false)
    })

    it("does not count a notice the reader refuses as the turn's answer", () => {
        // `readMcpServerNotice` returns null without a server name, so every renderer skips
        // this part. Counting it by type would call the turn answered and then draw nothing,
        // leaving a blank bubble where "no response" belongs.
        const message = {
            id: "a1",
            role: "assistant",
            parts: [{type: "data-mcp-server-failed", data: {serverName: "  "}}],
        } as unknown as UIMessage
        const status = deriveTurnStatus(message, {isUser: false, isStreaming: false})
        expect(status.hasAnswer).toBe(false)
        expect(status.noResponse).toBe(true)
    })

    it("trusts traceError on an answer-less turn", () => {
        const message = {id: "a1", role: "assistant", parts: []} as unknown as UIMessage
        const status = deriveTurnStatus(message, {
            isUser: false,
            isStreaming: false,
            traceError: "model quota exceeded",
        })
        expect(status.noResponse).toBe(true)
        expect(status.errorText).toBe("model quota exceeded")
        expect(status.showError).toBe(true)
        expect(status.isError).toBe(true)
    })

    it("reads a raw 413 trace body as the runner's too-large sentence, ahead of runError", () => {
        const message = {id: "a1", role: "assistant", parts: []} as unknown as UIMessage
        const status = deriveTurnStatus(message, {
            isUser: false,
            isStreaming: false,
            traceError: '413 {"error":{"message":"Request too large for org-abc123"}}',
            runError: "The request is too large for this model.",
        })
        expect(status.errorText).toMatch(/^The request is too large for this model\./)
        expect(status.errorText).not.toMatch(/org-|\{/)
    })

    it("shows the more specific trace error on a no-response turn with a generic runError", () => {
        const message = {id: "a1", role: "assistant", parts: []} as unknown as UIMessage
        const status = deriveTurnStatus(message, {
            isUser: false,
            isStreaming: false,
            traceError: "Tool bash failed: command not found: pyhton3",
            runError: "agent run failed",
        })
        expect(status.errorText).toBe("Tool bash failed: command not found: pyhton3")
    })

    it("falls back to runError when the trace recorded no error", () => {
        const message = {id: "a1", role: "assistant", parts: []} as unknown as UIMessage
        const status = deriveTurnStatus(message, {
            isUser: false,
            isStreaming: false,
            runError: "Too many requests right now. Try again in a moment.",
        })
        expect(status.errorText).toBe("Too many requests right now. Try again in a moment.")
    })

    it("prefers the runner's sentence when the runner classified the failure", () => {
        const message = {id: "a1", role: "assistant", parts: []} as unknown as UIMessage
        const status = deriveTurnStatus(message, {
            isUser: false,
            isStreaming: false,
            traceError: '429 {"error":{"message":"Rate limit reached for org-abc123"}}',
            runError: "Too many requests right now. Try again in a moment.",
            errorCode: "rate_limited",
        })
        expect(status.errorText).toBe("Too many requests right now. Try again in a moment.")
    })

    it("lets a trace error with braces lead a generic run error: braces are not a provider refusal", () => {
        const message = {id: "a1", role: "assistant", parts: []} as unknown as UIMessage
        const status = deriveTurnStatus(message, {
            isUser: false,
            isStreaming: false,
            traceError: "KeyError: {'name'} missing in template {{input}}",
            runError: "agent run failed",
            errorCode: "runner_error",
        })
        expect(status.errorText).toBe("KeyError: {'name'} missing in template {{input}}")
    })

    it("shows a raw provider body's reason, never the body, and never a credential", () => {
        const empty = {id: "a1", role: "assistant", parts: []} as unknown as UIMessage
        // A made-up key, assembled so secret scanners do not read the test as a credential.
        const fakeKey = ["sk", "live12345678"].join("-")
        const fromTrace = deriveTurnStatus(empty, {
            isUser: false,
            isStreaming: false,
            traceError: `403 {"error":{"message":"denied for key ${fakeKey}","organization":"org-abc123"}}`,
        })
        expect(fromTrace.errorText).toBe(
            "The model provider refused the request (HTTP 403): denied for key [secret].",
        )
        const fromRun = deriveTurnStatus(empty, {
            isUser: false,
            isStreaming: false,
            runError: `upstream said api_key=${fakeKey} at /home/sandbox/agenta/session`,
        })
        expect(fromRun.errorText).toBe(
            "upstream said api_key=[secret] at /home/sandbox/agenta/session",
        )
    })

    it("reads a 413 only as an HTTP status (never inside an id)", () => {
        const empty = {id: "a1", role: "assistant", parts: []} as unknown as UIMessage
        const status = deriveTurnStatus(empty, {
            isUser: false,
            isStreaming: false,
            traceError: "401 Unauthorized (request_id: req_ab413cd9)",
        })
        expect(status.errorText).toBe("401 Unauthorized (request_id: req_ab413cd9)")
    })

    it("never shows a raw provider body from the trace (QA R3W-5)", () => {
        const message = {id: "a1", role: "assistant", parts: []} as unknown as UIMessage
        const tooLarge = deriveTurnStatus(message, {
            isUser: false,
            isStreaming: false,
            traceError:
                '413 {"error":{"message":"Request too large for gpt in organization org-abc123"}}',
        })
        expect(tooLarge.errorText).toMatch(/too large for this model/)
        expect(tooLarge.errorText).not.toMatch(/org-|\{/)
        const refused = deriveTurnStatus(message, {
            isUser: false,
            isStreaming: false,
            traceError: 'Error: 400 {"type":"invalid_request_error"}',
        })
        expect(refused.errorText).toBe("The model provider refused the request (HTTP 400).")
        // Pi's OpenAI provider writes `OpenAI API error (404): {json}`; same rule as the runner.
        const openai = deriveTurnStatus(message, {
            isUser: false,
            isStreaming: false,
            traceError:
                'OpenAI API error (404): {"message":"The model `x-v99` does not exist.","code":"model_not_found"}',
        })
        expect(openai.errorText).toBe(
            "The model provider refused the request (HTTP 404): The model `x-v99` does not exist.",
        )
        // The same text after pi-acp's `Internal error: ` label (ST-IP-1).
        const wrapped = deriveTurnStatus(message, {
            isUser: false,
            isStreaming: false,
            traceError:
                'Internal error: OpenAI API error (404): {"message":"The model `x-v99` does not exist.","code":"model_not_found"}',
        })
        expect(wrapped.errorText).toBe(
            "The model provider refused the request (HTTP 404): The model `x-v99` does not exist.",
        )
        const busy = deriveTurnStatus(message, {
            isUser: false,
            isStreaming: false,
            traceError: '503 {"message":"overloaded"}',
        })
        expect(busy.errorText).toBe(
            "The model provider could not answer (HTTP 503): overloaded. Try again in a moment.",
        )
    })

    it("ignores traceError once the turn produced an answer", () => {
        const message = {
            id: "a1",
            role: "assistant",
            parts: [{type: "text", text: "here you go"}],
        } as unknown as UIMessage
        const status = deriveTurnStatus(message, {
            isUser: false,
            isStreaming: false,
            traceError: "swallowed tool-level error",
        })
        expect(status.noResponse).toBe(false)
        expect(status.errorText).toBeNull()
        expect(status.showError).toBe(false)
        expect(status.isError).toBe(false)
    })

    it("always counts runError, even on a turn that produced an answer", () => {
        const message = {
            id: "a1",
            role: "assistant",
            parts: [{type: "text", text: "partial answer"}],
        } as unknown as UIMessage
        const status = deriveTurnStatus(message, {
            isUser: false,
            isStreaming: false,
            runError: "stream died",
        })
        expect(status.noResponse).toBe(false)
        expect(status.errorText).toBe("stream died")
        expect(status.showError).toBe(true)
        // isError stays answer-less-only — a turn with an answer never renders as a full failure.
        expect(status.isError).toBe(false)
    })

    it("suppresses showError while the turn is still streaming", () => {
        const message = {id: "a1", role: "assistant", parts: []} as unknown as UIMessage
        const status = deriveTurnStatus(message, {
            isUser: false,
            isStreaming: true,
            runError: "stream died",
        })
        expect(status.showError).toBe(false)
        expect(status.isError).toBe(false)
    })

    it("carries the failure class alongside a shown error", () => {
        const message = {id: "a1", role: "assistant", parts: []} as unknown as UIMessage
        const status = deriveTurnStatus(message, {
            isUser: false,
            isStreaming: false,
            runError: "out of credits",
            errorCode: "starter_credits_exhausted",
        })
        expect(status.showError).toBe(true)
        expect(status.errorCode).toBe("starter_credits_exhausted")
    })

    it("drops the failure class while the turn is still streaming", () => {
        const message = {id: "a1", role: "assistant", parts: []} as unknown as UIMessage
        const status = deriveTurnStatus(message, {
            isUser: false,
            isStreaming: true,
            runError: "out of credits",
            errorCode: "starter_credits_exhausted",
        })
        expect(status.showError).toBe(false)
        expect(status.errorCode).toBeNull()
    })

    it("drops the failure class when no error is surfaced", () => {
        const message = {
            id: "a1",
            role: "assistant",
            parts: [{type: "text", text: "all good"}],
        } as unknown as UIMessage
        const status = deriveTurnStatus(message, {
            isUser: false,
            isStreaming: false,
            errorCode: "starter_credits_exhausted",
        })
        expect(status.showError).toBe(false)
        expect(status.errorCode).toBeNull()
    })
})

// The runner's vectors (services/runner/tests/unit/sandbox-agent-errors.test.ts), so the two ports
// cannot drift apart unnoticed.
describe("sanitizeErrorText", () => {
    it("redacts credentials only, the way the runner does: numbers, ids and paths stay", () => {
        expect(
            sanitizeErrorText(
                "provider failed: org-private123 sandbox sbx-123 at /home/sandbox/agenta/session",
            ),
        ).toBe("provider failed: org-private123 sandbox sbx-123 at /home/sandbox/agenta/session")
        expect(sanitizeErrorText("max_tokens: 4096 exceeds model limit")).toBe(
            "max_tokens: 4096 exceeds model limit",
        )
        expect(sanitizeErrorText("input_tokens=12000 prompt_tokens: 900")).toBe(
            "input_tokens=12000 prompt_tokens: 900",
        )
        expect(sanitizeErrorText("test-reached-sandbox-start")).toBe("test-reached-sandbox-start")
        expect(sanitizeErrorText("see https://example.com/a/b and src/main.py")).toBe(
            "see https://example.com/a/b and src/main.py",
        )
    })

    it("redacts credentials however they are written (Codex R5 P1-5)", () => {
        expect(
            sanitizeErrorText(
                "upstream answered 401 for Authorization: Bearer abcDEF123.ghi-jkl_456",
            ),
        ).toBe("upstream answered 401 for Authorization: Bearer [secret]")
        expect(sanitizeErrorText("call failed with api_key=abc123def and token: xyz789")).toBe(
            "call failed with api_key=[secret] and token=[secret]",
        )
        expect(sanitizeErrorText("OPENAI_API_KEY=abcdef123 refresh_token: r1-xyz")).toBe(
            "OPENAI_API_KEY=[secret] refresh_token=[secret]",
        )
        expect(sanitizeErrorText("jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig rejected")).toBe(
            "jwt [secret] rejected",
        )
    })

    it("redacts anything shaped like a key", () => {
        expect(sanitizeErrorText("bad key sk-abcdefgh1234 rejected")).toBe(
            "bad key [secret] rejected",
        )
    })

    it("redacts any Authorization scheme in a quoted JSON header (Codex R9-3)", () => {
        expect(sanitizeErrorText('{"Authorization": "Token abcdefghijklmnop"}')).toBe(
            '{"Authorization": "Token [secret]"}',
        )
        expect(sanitizeErrorText("{'authorization': 'Digest abcdefghijklmnop'}")).toBe(
            "{'authorization': 'Digest [secret]'}",
        )
        expect(sanitizeErrorText('{"Authorization":"Bearer abcdefghijklmnop"}')).toBe(
            '{"Authorization":"Bearer [secret]"}',
        )
    })

    it("redacts a credential whose value is all digits or all letters, and plural key fields (Codex round 8)", () => {
        expect(sanitizeErrorText("password=123456 rejected")).toBe("password=[secret] rejected")
        expect(sanitizeErrorText("token=123456 rejected")).toBe("token=[secret] rejected")
        expect(sanitizeErrorText("Authorization: Token abcdefghijklmnop")).toBe(
            "Authorization: Token [secret]",
        )
        expect(sanitizeErrorText("api_keys=abcdefghijk rejected")).toBe(
            "api_keys=[secret] rejected",
        )
        expect(sanitizeErrorText("max_tokens: 4096 and input_tokens=12000 stay")).toBe(
            "max_tokens: 4096 and input_tokens=12000 stay",
        )
        expect(sanitizeErrorText("Token verification failed")).toBe("Token verification failed")
    })
})

describe("readableTraceError", () => {
    it("reads a bare status body", () => {
        expect(readableTraceError('400 {"error":"bad request"}')).toBe(
            "The model provider refused the request (HTTP 400): bad request.",
        )
    })

    it("reads a labeled status body", () => {
        expect(readableTraceError('Label: 429 {"error":{"message":"slow down"}}')).toBe(
            "The model provider could not answer (HTTP 429): slow down. Try again in a moment.",
        )
    })

    it("reads a nested-label provider body, e.g. OpenAI's own wrapper", () => {
        expect(
            readableTraceError(
                'Internal error: OpenAI API error (404): {"error":{"message":"model not found"}}',
            ),
        ).toBe("The model provider refused the request (HTTP 404): model not found.")
    })

    it("returns the request-too-large sentence for 413 regardless of body", () => {
        expect(readableTraceError('413 {"error":"payload too large"}')).toBe(
            "The request is too large for this model. Start a new session, turn off tools you do not need, or pick a model with a larger context.",
        )
    })

    it("falls back to sanitized text when the body has no recognizable raw shape", () => {
        expect(readableTraceError("connection reset by peer")).toBe("connection reset by peer")
    })

    // Regression for CodeQL js/polynomial-redos: a run of letters/spaces with no colon or
    // brace used to make RAW_PROVIDER_BODY backtrack catastrophically. This must return well
    // under a second even for a large adversarial input.
    it("stays fast on a long run of letters and spaces with no match (CodeQL js/polynomial-redos)", () => {
        const evil = "A ".repeat(50_000) + "no match here"
        const start = performance.now()
        const result = readableTraceError(evil)
        const elapsedMs = performance.now() - start
        expect(elapsedMs).toBeLessThan(1_000)
        expect(result).toBe(sanitizeErrorText(evil))
    })
})

describe("the public error contract, round 6 (Codex R6 P1-5)", () => {
    const empty = {id: "a", role: "assistant", parts: []} as unknown as UIMessage

    it("never shows a trace's text in place of a sentence whose text the runner withheld (Codex's reproduction)", () => {
        const status = deriveTurnStatus(empty, {
            isUser: false,
            isStreaming: false,
            runError: "The agent run failed (reference abc).",
            errorCode: "internal_error",
            traceError: "upstream failed: password='hunter-value'",
        })
        expect(status.errorText).toBe("The agent run failed (reference abc).")
    })

    it("still lets a specific trace error lead a generic run error, sanitized the same way", () => {
        const status = deriveTurnStatus(empty, {
            isUser: false,
            isStreaming: false,
            runError: "agent run failed",
            errorCode: "runner_error",
            traceError: "upstream failed: password='hunter-value'",
        })
        expect(status.errorText).toBe("upstream failed: password=[secret]")
    })

    it("redacts quoted credentials exactly as the runner does", () => {
        expect(sanitizeErrorText("upstream failed: password='hunter-value'")).toBe(
            "upstream failed: password=[secret]",
        )
        expect(sanitizeErrorText('upstream failed: token="sensitive-value"')).toBe(
            "upstream failed: token=[secret]",
        )
        expect(sanitizeErrorText("login failed: password='two words'")).toBe(
            "login failed: password=[secret]",
        )
        expect(sanitizeErrorText("config {'api_key': 'abc def ghi'} rejected")).toBe(
            "config {api_key=[secret]} rejected",
        )
        expect(sanitizeErrorText("headers x-api-key: `abcdef` and secret=`s3cr3t`")).toBe(
            "headers x-api-key=[secret] and secret=[secret]",
        )
        expect(sanitizeErrorText("cut off: password='hunter")).toBe("cut off: password=[secret]")
        expect(
            sanitizeErrorText("the key is missing; see https://example.com/a for openai/gpt-4o"),
        ).toBe("the key is missing; see https://example.com/a for openai/gpt-4o")
    })
})
