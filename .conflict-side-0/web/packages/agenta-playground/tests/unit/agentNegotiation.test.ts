/**
 * Unit tests for `createNegotiatingFetch` — the agent lane's stream→batch→error negotiation.
 *
 * Guards the three outcomes JP's fixed-toggle cut couldn't express, each of which fails
 * SILENTLY (a stream parser fed batch JSON, or a swallowed error) if untested:
 *   1. stream honoured   → parse as SSE         (resolvedMode "stream")
 *   2. 406 (can't stream)→ re-request as batch  (resolvedMode "batch", Accept flips to json)
 *   3. real error (5xx)  → pass through untouched so useChat surfaces it inline
 * Plus: an explicit batch request skips the stream attempt, and a server that answers a
 * stream request with batch JSON is trusted by Content-Type.
 */
import {describe, expect, it, vi} from "vitest"

import {createNegotiatingFetch} from "../../src/state/execution/agentNegotiation"

const res = (body: string, init: {status?: number; contentType?: string}) =>
    new Response(body, {
        status: init.status ?? 200,
        headers: init.contentType ? {"content-type": init.contentType} : undefined,
    })

const acceptOf = (init: RequestInit | undefined) =>
    new Headers(init?.headers as HeadersInit).get("accept") ?? ""

describe("createNegotiatingFetch", () => {
    it("honours a stream when the server answers text/event-stream", async () => {
        const base = vi.fn(async () => res("data: {}\n\n", {contentType: "text/event-stream"}))
        const {fetch, resolvedMode} = createNegotiatingFetch(
            base as unknown as typeof globalThis.fetch,
        )

        const r = await fetch("/invoke", {headers: {Accept: "text/event-stream"}})

        expect(r.status).toBe(200)
        expect(resolvedMode()).toBe("stream")
        expect(base).toHaveBeenCalledTimes(1)
    })

    it("falls back to a batch re-request when the server 406s a stream request", async () => {
        const base = vi
            .fn()
            .mockResolvedValueOnce(res("not acceptable", {status: 406}))
            .mockResolvedValueOnce(res('{"data":{}}', {contentType: "application/json"}))
        const {fetch, resolvedMode} = createNegotiatingFetch(
            base as unknown as typeof globalThis.fetch,
        )

        const r = await fetch("/invoke", {headers: {Accept: "text/event-stream"}})

        expect(r.status).toBe(200)
        expect(resolvedMode()).toBe("batch")
        expect(base).toHaveBeenCalledTimes(2)
        // the retry asked for batch JSON, dropping the stream Accept
        expect(acceptOf(base.mock.calls[1][1])).toBe("application/json")
    })

    it("passes a real error (5xx) through untouched without a second request", async () => {
        const base = vi.fn(async () =>
            res('{"status":{"code":500,"message":"boom"}}', {
                status: 500,
                contentType: "application/json",
            }),
        )
        const {fetch} = createNegotiatingFetch(base as unknown as typeof globalThis.fetch)

        const r = await fetch("/invoke", {headers: {Accept: "text/event-stream"}})

        expect(r.status).toBe(500)
        expect(await r.text()).toContain("boom")
        expect(base).toHaveBeenCalledTimes(1) // no batch fallback on a non-406 error
    })

    it("skips the stream attempt when batch is requested explicitly", async () => {
        const base = vi.fn(async () => res('{"data":{}}', {contentType: "application/json"}))
        const {fetch, resolvedMode} = createNegotiatingFetch(
            base as unknown as typeof globalThis.fetch,
        )

        await fetch("/invoke", {headers: {Accept: "application/json"}})

        expect(resolvedMode()).toBe("batch")
        expect(base).toHaveBeenCalledTimes(1)
        expect(acceptOf(base.mock.calls[0][1])).toBe("application/json")
    })

    it("trusts the response Content-Type: a stream request answered with JSON resolves to batch", async () => {
        const base = vi.fn(async () => res('{"data":{}}', {contentType: "application/json"}))
        const {fetch, resolvedMode} = createNegotiatingFetch(
            base as unknown as typeof globalThis.fetch,
        )

        await fetch("/invoke", {headers: {Accept: "text/event-stream"}})

        expect(resolvedMode()).toBe("batch")
        expect(base).toHaveBeenCalledTimes(1)
    })
})
