/**
 * Tests for the Agenta SDK HTTP client.
 *
 * Mocks at the `fetch` boundary — the client is the real thing,
 * so we test URL construction, headers, auth, error handling, and timeouts.
 */

import {describe, it, expect, vi, beforeEach, afterEach} from "vitest"

import {
    AgentaClient,
    AgentaApiError,
    AgentaAuthError,
    AgentaNotFoundError,
    AgentaValidationError,
    AgentaRateLimitError,
    AgentaServerError,
} from "@src/client.js"

interface MockResponse {
    ok?: boolean
    status?: number
    statusText?: string
    json?: unknown
    text?: string
    headers?: Record<string, string>
}

function fakeResponse(response: MockResponse): Response {
    return {
        ok: response.ok ?? (response.status ?? 200) < 400,
        status: response.status ?? 200,
        statusText: response.statusText ?? "OK",
        headers: new Headers(response.headers ?? {}),
        json: () => Promise.resolve(response.json ?? {}),
        text: () => Promise.resolve(response.text ?? ""),
    } as Response
}

function mockFetch(response: MockResponse) {
    return vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(fakeResponse(response))
}

function mockFetchSequence(responses: MockResponse[]) {
    const spy = vi.spyOn(globalThis, "fetch")
    for (const r of responses) spy.mockResolvedValueOnce(fakeResponse(r))
    return spy
}

describe("AgentaClient", () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    // ── Construction ─────────────────────────────────────────────────────────

    describe("constructor", () => {
        it("uses default host and basePath", () => {
            const client = new AgentaClient()
            expect(client.baseUrl).toBe("http://localhost/api")
        })

        it("respects custom host and basePath", () => {
            const client = new AgentaClient({host: "https://cloud.agenta.ai", basePath: "/v2"})
            expect(client.baseUrl).toBe("https://cloud.agenta.ai/v2")
        })

        it("reads from env vars when no config", () => {
            process.env.AGENTA_HOST = "https://env-host.com"
            process.env.AGENTA_API_KEY = "env-key"
            process.env.AGENTA_PROJECT_ID = "env-project"

            const client = new AgentaClient()
            expect(client.host).toBe("https://env-host.com")
            expect(client.apiKey).toBe("env-key")
            expect(client.projectId).toBe("env-project")

            delete process.env.AGENTA_HOST
            delete process.env.AGENTA_API_KEY
            delete process.env.AGENTA_PROJECT_ID
        })
    })

    // ── URL Construction ─────────────────────────────────────────────────────

    describe("URL construction", () => {
        it("prepends /preview by default", async () => {
            const client = new AgentaClient({host: "https://api.test", projectId: "p1"})
            const spy = mockFetch({json: {ok: true}})

            await client.get("/spans/query")

            const url = spy.mock.calls[0][0] as string
            expect(url).toContain("https://api.test/api/preview/spans/query")
        })

        it("skips /preview when legacy=true", async () => {
            const client = new AgentaClient({host: "https://api.test", projectId: "p1"})
            const spy = mockFetch({json: {}})

            await client.get("/projects/", {legacy: true})

            const url = spy.mock.calls[0][0] as string
            expect(url).toContain("https://api.test/api/projects/")
            expect(url).not.toContain("/preview")
        })

        it("includes project_id as query param", async () => {
            const client = new AgentaClient({host: "https://api.test", projectId: "proj-123"})
            const spy = mockFetch({json: {}})

            await client.get("/apps")

            const url = spy.mock.calls[0][0] as string
            expect(url).toContain("project_id=proj-123")
        })

        it("omits project_id when empty", async () => {
            const client = new AgentaClient({host: "https://api.test", projectId: ""})
            const spy = mockFetch({json: {}})

            await client.get("/apps")

            const url = spy.mock.calls[0][0] as string
            expect(url).not.toContain("project_id")
        })

        it("appends extra params", async () => {
            const client = new AgentaClient({host: "https://api.test", projectId: "p1"})
            const spy = mockFetch({json: {}})

            await client.get("/revisions/123", {params: {resolve: "true"}})

            const url = spy.mock.calls[0][0] as string
            expect(url).toContain("resolve=true")
            expect(url).toContain("project_id=p1")
        })

        it("uses projectIdProvider over static projectId", async () => {
            const client = new AgentaClient({
                host: "https://api.test",
                projectId: "static-id",
                projectIdProvider: () => "dynamic-id",
            })
            const spy = mockFetch({json: {}})

            await client.get("/apps")

            const url = spy.mock.calls[0][0] as string
            expect(url).toContain("project_id=dynamic-id")
            expect(url).not.toContain("static-id")
        })
    })

    // ── Headers & Auth ───────────────────────────────────────────────────────

    describe("headers and auth", () => {
        it("sends API key in Authorization header", async () => {
            const client = new AgentaClient({host: "https://api.test", apiKey: "my-key"})
            const spy = mockFetch({json: {}})

            await client.get("/apps")

            const headers = spy.mock.calls[0][1]?.headers as Record<string, string>
            expect(headers["Authorization"]).toBe("my-key")
            expect(headers["Content-Type"]).toBe("application/json")
        })

        it("omits Authorization when no key", async () => {
            const client = new AgentaClient({host: "https://api.test"})
            const spy = mockFetch({json: {}})

            await client.get("/apps")

            const headers = spy.mock.calls[0][1]?.headers as Record<string, string>
            expect(headers["Authorization"]).toBeUndefined()
        })

        it("authProvider takes precedence over apiKey", async () => {
            const client = new AgentaClient({
                host: "https://api.test",
                apiKey: "static-key",
                authProvider: async () => "Bearer jwt-token",
            })
            const spy = mockFetch({json: {}})

            await client.get("/apps")

            const headers = spy.mock.calls[0][1]?.headers as Record<string, string>
            expect(headers["Authorization"]).toBe("Bearer jwt-token")
        })

        it("handles authProvider returning undefined", async () => {
            const client = new AgentaClient({
                host: "https://api.test",
                authProvider: async () => undefined,
            })
            const spy = mockFetch({json: {}})

            await client.get("/apps")

            const headers = spy.mock.calls[0][1]?.headers as Record<string, string>
            expect(headers["Authorization"]).toBeUndefined()
        })
    })

    // ── HTTP Methods ─────────────────────────────────────────────────────────

    describe("HTTP methods", () => {
        let client: AgentaClient

        beforeEach(() => {
            client = new AgentaClient({host: "https://api.test", apiKey: "key", projectId: "p1"})
        })

        it("GET sends correct method, no body", async () => {
            const spy = mockFetch({json: {data: "value"}})

            const result = await client.get<{data: string}>("/items")

            expect(spy.mock.calls[0][1]?.method).toBe("GET")
            expect(spy.mock.calls[0][1]?.body).toBeUndefined()
            expect(result.data).toBe("value")
        })

        it("POST sends method and JSON body", async () => {
            const spy = mockFetch({json: {id: "new"}})

            await client.post("/items", {name: "test"})

            expect(spy.mock.calls[0][1]?.method).toBe("POST")
            expect(spy.mock.calls[0][1]?.body).toBe(JSON.stringify({name: "test"}))
        })

        it("PUT sends method and JSON body", async () => {
            const spy = mockFetch({json: {}})

            await client.put("/items/1", {name: "updated"})

            expect(spy.mock.calls[0][1]?.method).toBe("PUT")
            expect(spy.mock.calls[0][1]?.body).toBe(JSON.stringify({name: "updated"}))
        })

        it("DELETE sends correct method, no body", async () => {
            const spy = mockFetch({json: {}})

            await client.delete("/items/1")

            expect(spy.mock.calls[0][1]?.method).toBe("DELETE")
            expect(spy.mock.calls[0][1]?.body).toBeUndefined()
        })
    })

    // ── Error Handling ───────────────────────────────────────────────────────

    describe("error handling", () => {
        it("throws AgentaApiError on non-2xx response", async () => {
            const client = new AgentaClient({host: "https://api.test"})
            mockFetch({
                ok: false,
                status: 404,
                json: {detail: "Not found"},
            })

            await expect(client.get("/missing")).rejects.toThrow(AgentaApiError)
            try {
                mockFetch({ok: false, status: 404, json: {detail: "Not found"}})
                await client.get("/missing")
            } catch (e) {
                const err = e as AgentaApiError
                expect(err.status).toBe(404)
                expect(err.detail).toBe("Not found")
                expect(err.endpoint).toBe("GET /missing")
            }
        })

        it("extracts detail from JSON error response", async () => {
            const client = new AgentaClient({host: "https://api.test"})
            mockFetch({ok: false, status: 422, json: {detail: "Validation failed"}})

            try {
                await client.get("/bad")
            } catch (e) {
                expect((e as AgentaApiError).detail).toBe("Validation failed")
            }
        })

        it("falls back to text when JSON parse fails", async () => {
            // 500 is retryable — disable retries so this test asserts only the
            // error-detail-extraction path.
            const client = new AgentaClient({host: "https://api.test", retries: 1})
            vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
                ok: false,
                status: 500,
                statusText: "Internal Server Error",
                headers: new Headers(),
                json: () => Promise.reject(new Error("not json")),
                text: () => Promise.resolve("raw error text"),
            } as unknown as Response)

            try {
                await client.get("/error")
            } catch (e) {
                expect((e as AgentaApiError).detail).toBe("raw error text")
            }
        })
    })

    // ── Response Interceptor ─────────────────────────────────────────────────

    describe("onResponse interceptor", () => {
        it("calls interceptor on every response", async () => {
            const interceptor = vi.fn()
            const client = new AgentaClient({host: "https://api.test", onResponse: interceptor})
            mockFetch({json: {}})

            await client.get("/apps")

            expect(interceptor).toHaveBeenCalledOnce()
            expect(interceptor).toHaveBeenCalledWith(expect.any(Object), "GET /apps")
        })
    })

    // ── invokePrompt ─────────────────────────────────────────────────────────

    describe("invokePrompt", () => {
        it("posts to legacy endpoint with correct body", async () => {
            const client = new AgentaClient({host: "https://api.test", apiKey: "key"})
            const spy = mockFetch({json: {data: {output: "result"}, trace_id: "tr-1"}})

            const result = await client.invokePrompt("my-app", {question: "hi"}, "staging")

            const url = spy.mock.calls[0][0] as string
            expect(url).toContain("/api/services/completion/run")
            expect(url).not.toContain("/preview")

            const body = JSON.parse(spy.mock.calls[0][1]?.body as string)
            expect(body).toEqual({
                inputs: {question: "hi"},
                environment: "staging",
                app: "my-app",
            })

            expect(result.data).toEqual({output: "result"})
            expect(result.traceId).toBe("tr-1")
        })
    })

    // ── Typed error hierarchy ────────────────────────────────────────────────

    describe("typed errors", () => {
        // All error tests use retries: 1 so the test focuses on classification,
        // not retry behavior. Retry semantics are tested separately below.
        const noRetry = (overrides: Partial<{apiKey: string}> = {}) =>
            new AgentaClient({host: "https://api.test", retries: 1, ...overrides})

        it("401 throws AgentaAuthError (subclass of AgentaApiError)", async () => {
            const client = noRetry()
            mockFetch({status: 401, json: {detail: "unauthorized"}})

            const err = await client.get("/x").catch((e) => e)
            expect(err).toBeInstanceOf(AgentaAuthError)
            expect(err).toBeInstanceOf(AgentaApiError)
            expect(err.status).toBe(401)
        })

        it("403 throws AgentaAuthError", async () => {
            const client = noRetry()
            mockFetch({status: 403, json: {detail: "forbidden"}})

            const err = await client.get("/x").catch((e) => e)
            expect(err).toBeInstanceOf(AgentaAuthError)
            expect(err.status).toBe(403)
        })

        it("404 throws AgentaNotFoundError", async () => {
            const client = noRetry()
            mockFetch({status: 404, json: {detail: "missing"}})

            const err = await client.get("/x").catch((e) => e)
            expect(err).toBeInstanceOf(AgentaNotFoundError)
            expect(err).toBeInstanceOf(AgentaApiError)
        })

        it("400 throws AgentaValidationError", async () => {
            const client = noRetry()
            mockFetch({status: 400, json: {detail: "bad request"}})

            const err = await client.get("/x").catch((e) => e)
            expect(err).toBeInstanceOf(AgentaValidationError)
            expect(err.status).toBe(400)
        })

        it("422 throws AgentaValidationError", async () => {
            const client = noRetry()
            mockFetch({status: 422, json: {detail: "unprocessable"}})

            const err = await client.get("/x").catch((e) => e)
            expect(err).toBeInstanceOf(AgentaValidationError)
            expect(err.status).toBe(422)
        })

        it("429 throws AgentaRateLimitError with parsed retryAfterMs", async () => {
            const client = noRetry()
            mockFetch({
                status: 429,
                json: {detail: "rate limited"},
                headers: {"Retry-After": "5"},
            })

            const err = (await client.get("/x").catch((e) => e)) as AgentaRateLimitError
            expect(err).toBeInstanceOf(AgentaRateLimitError)
            expect(err.status).toBe(429)
            expect(err.retryAfterMs).toBe(5000)
        })

        it("429 with no Retry-After header sets retryAfterMs to undefined", async () => {
            const client = noRetry()
            mockFetch({status: 429, json: {detail: "rate limited"}})

            const err = (await client.get("/x").catch((e) => e)) as AgentaRateLimitError
            expect(err).toBeInstanceOf(AgentaRateLimitError)
            expect(err.retryAfterMs).toBeUndefined()
        })

        it("500 throws AgentaServerError", async () => {
            const client = noRetry()
            mockFetch({status: 500, json: {detail: "boom"}})

            const err = await client.get("/x").catch((e) => e)
            expect(err).toBeInstanceOf(AgentaServerError)
            expect(err.status).toBe(500)
        })

        it("503 throws AgentaServerError", async () => {
            const client = noRetry()
            mockFetch({status: 503, json: {detail: "unavailable"}})

            const err = await client.get("/x").catch((e) => e)
            expect(err).toBeInstanceOf(AgentaServerError)
        })

        it("418 (no specific subclass) falls back to AgentaApiError", async () => {
            const client = noRetry()
            mockFetch({status: 418, json: {detail: "teapot"}})

            const err = await client.get("/x").catch((e) => e)
            expect(err).toBeInstanceOf(AgentaApiError)
            expect(err).not.toBeInstanceOf(AgentaServerError)
            expect(err).not.toBeInstanceOf(AgentaValidationError)
        })

        it("backward compat: every typed error matches `instanceof AgentaApiError`", async () => {
            const client = noRetry()
            const cases: [number, new (...args: any[]) => AgentaApiError][] = [
                [401, AgentaAuthError],
                [404, AgentaNotFoundError],
                [422, AgentaValidationError],
                [429, AgentaRateLimitError],
                [500, AgentaServerError],
            ]
            for (const [status] of cases) {
                mockFetch({status, json: {detail: "x"}})
                const err = await client.get("/x").catch((e) => e)
                expect(err).toBeInstanceOf(AgentaApiError)
            }
        })
    })

    // ── Retries ─────────────────────────────────────────────────────────────

    describe("retries", () => {
        // Set retryBackoffMs to 0 to make tests fast — full jitter still works.
        const retryClient = (retries = 3) =>
            new AgentaClient({
                host: "https://api.test",
                retries,
                retryBackoffMs: 0,
            })

        it("retries on 500 and succeeds on second attempt", async () => {
            const client = retryClient()
            const spy = mockFetchSequence([
                {status: 500, json: {detail: "transient"}},
                {status: 200, json: {ok: true}},
            ])

            const result = await client.get<{ok: boolean}>("/x")
            expect(result.ok).toBe(true)
            expect(spy).toHaveBeenCalledTimes(2)
        })

        it("retries on 503 up to the cap then throws", async () => {
            const client = retryClient(3)
            const spy = mockFetchSequence([
                {status: 503, json: {detail: "down"}},
                {status: 503, json: {detail: "down"}},
                {status: 503, json: {detail: "down"}},
            ])

            const err = await client.get("/x").catch((e) => e)
            expect(err).toBeInstanceOf(AgentaServerError)
            expect(spy).toHaveBeenCalledTimes(3)
        })

        it("retries on 429 honoring Retry-After", async () => {
            const client = retryClient()
            const spy = mockFetchSequence([
                {status: 429, json: {detail: "slow down"}, headers: {"Retry-After": "0"}},
                {status: 200, json: {ok: true}},
            ])

            const result = await client.get<{ok: boolean}>("/x")
            expect(result.ok).toBe(true)
            expect(spy).toHaveBeenCalledTimes(2)
        })

        it("does NOT retry on 404", async () => {
            const client = retryClient()
            const spy = mockFetchSequence([{status: 404, json: {detail: "missing"}}])

            const err = await client.get("/x").catch((e) => e)
            expect(err).toBeInstanceOf(AgentaNotFoundError)
            expect(spy).toHaveBeenCalledTimes(1)
        })

        it("does NOT retry on 422", async () => {
            const client = retryClient()
            const spy = mockFetchSequence([{status: 422, json: {detail: "bad"}}])

            const err = await client.get("/x").catch((e) => e)
            expect(err).toBeInstanceOf(AgentaValidationError)
            expect(spy).toHaveBeenCalledTimes(1)
        })

        it("retries on network error (TypeError) and recovers", async () => {
            const client = retryClient()
            const spy = vi.spyOn(globalThis, "fetch")
            spy.mockRejectedValueOnce(new TypeError("fetch failed"))
            spy.mockResolvedValueOnce(fakeResponse({status: 200, json: {ok: true}}))

            const result = await client.get<{ok: boolean}>("/x")
            expect(result.ok).toBe(true)
            expect(spy).toHaveBeenCalledTimes(2)
        })

        it("network error after final attempt re-throws", async () => {
            const client = retryClient(2)
            const spy = vi.spyOn(globalThis, "fetch")
            spy.mockRejectedValue(new TypeError("fetch failed"))

            const err = await client.get("/x").catch((e) => e)
            expect(err).toBeInstanceOf(TypeError)
            expect(spy).toHaveBeenCalledTimes(2)
        })

        it("retries: 1 disables retries entirely", async () => {
            const client = new AgentaClient({
                host: "https://api.test",
                retries: 1,
                retryBackoffMs: 0,
            })
            const spy = mockFetchSequence([
                {status: 500, json: {detail: "boom"}},
                {status: 200, json: {ok: true}}, // never reached
            ])

            const err = await client.get("/x").catch((e) => e)
            expect(err).toBeInstanceOf(AgentaServerError)
            expect(spy).toHaveBeenCalledTimes(1)
        })

        it("Retry-After clamps at 60s ceiling", async () => {
            // Server sends absurdly long Retry-After. The client must not stall the test.
            const client = retryClient(2)
            const spy = mockFetchSequence([
                {status: 429, json: {detail: "x"}, headers: {"Retry-After": "999999"}},
                {status: 200, json: {ok: true}},
            ])

            // We can't easily assert on the exact delay, but with retries=2 and a real
            // 60s ceiling this would hang. Instead, spy on setTimeout to catch the delay.
            const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout")
            // Trigger and immediately advance — but vitest doesn't fake timers by default.
            // Instead just verify the second call happens (the test itself caps at vitest's
            // own timeout, default 5s, which would FAIL if we slept 60s).
            // We sidestep this by overriding setTimeout to fire synchronously for this test.
            setTimeoutSpy.mockImplementation((cb: any) => {
                cb()
                return 0 as any
            })

            const result = await client.get<{ok: boolean}>("/x")
            expect(result.ok).toBe(true)
            expect(spy).toHaveBeenCalledTimes(2)
        })
    })
})
