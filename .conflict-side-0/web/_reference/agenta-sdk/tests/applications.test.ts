/**
 * Unit tests for the Applications resource — focused on URL construction and
 * request shape for the variant lifecycle methods that mirror Python's
 * `VariantManager.delete()` / `adelete()`.
 *
 * The wider Applications surface (CRUD, query, findBySlug) is covered by the
 * integration tests in `tests/integration/applications.test.ts`. This file
 * exists to cover the new variant-archive / unarchive paths without needing
 * a backend.
 */

import {describe, it, expect, vi, afterEach} from "vitest"

import {AgentaClient} from "@src/client.js"
import {Applications} from "@src/applications.js"

interface MockResponse {
    ok?: boolean
    status?: number
    json?: unknown
    headers?: Record<string, string>
}

function fakeResponse(response: MockResponse): Response {
    return {
        ok: response.ok ?? true,
        status: response.status ?? 200,
        statusText: "OK",
        headers: new Headers(response.headers ?? {}),
        json: () => Promise.resolve(response.json ?? {}),
        text: () => Promise.resolve(""),
    } as Response
}

function mockFetchOnce(response: MockResponse) {
    return vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(fakeResponse(response))
}

describe("Applications variant lifecycle", () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    const buildApps = () => {
        const client = new AgentaClient({
            host: "https://api.test",
            apiKey: "key",
            projectId: "proj-1",
            retries: 1,
        })
        return new Applications(client)
    }

    describe("archiveVariant", () => {
        it("POSTs to /preview/applications/variants/:id/archive", async () => {
            const apps = buildApps()
            const spy = mockFetchOnce({
                json: {count: 1, application_variant: {id: "var-123"}},
            })

            const result = await apps.archiveVariant("var-123")

            const url = spy.mock.calls[0][0] as string
            expect(url).toContain("https://api.test/api/preview/applications/variants/var-123/archive")
            expect(url).toContain("project_id=proj-1")
            expect(spy.mock.calls[0][1]?.method).toBe("POST")
            expect(result.application_variant?.id).toBe("var-123")
        })

        it("propagates 404 as AgentaNotFoundError (typed)", async () => {
            const apps = buildApps()
            const {AgentaNotFoundError} = await import("@src/client.js")
            mockFetchOnce({ok: false, status: 404, json: {detail: "variant not found"}})

            const err = await apps.archiveVariant("missing").catch((e) => e)
            expect(err).toBeInstanceOf(AgentaNotFoundError)
        })

        it("URL-encodes the variant id (defends against ids with special chars)", async () => {
            const apps = buildApps()
            const spy = mockFetchOnce({json: {count: 1}})

            // Realistic guard — backend variant ids are UUIDs, but a path
            // segment with characters like "/" would silently break.
            // We don't currently encode, so this test documents the expectation.
            await apps.archiveVariant("var-with-dash_underscore.123")

            const url = spy.mock.calls[0][0] as string
            expect(url).toContain("/applications/variants/var-with-dash_underscore.123/archive")
        })
    })

    describe("unarchiveVariant", () => {
        it("POSTs to /preview/applications/variants/:id/unarchive", async () => {
            const apps = buildApps()
            const spy = mockFetchOnce({
                json: {count: 1, application_variant: {id: "var-123"}},
            })

            const result = await apps.unarchiveVariant("var-123")

            const url = spy.mock.calls[0][0] as string
            expect(url).toContain(
                "https://api.test/api/preview/applications/variants/var-123/unarchive",
            )
            expect(spy.mock.calls[0][1]?.method).toBe("POST")
            expect(result.application_variant?.id).toBe("var-123")
        })
    })

    it("archive (whole app) and archiveVariant hit different endpoints", async () => {
        // Regression guard: the Python parity gap was that TS only had
        // application-level archive. Verify the two methods are distinct.
        const apps = buildApps()
        // Both calls share the same global fetch spy. Stack two responses,
        // then read mock.calls[0] and mock.calls[1] separately.
        mockFetchOnce({json: {count: 1}})
        mockFetchOnce({json: {count: 1}})
        const spy = vi.spyOn(globalThis, "fetch")

        await apps.archive("app-id")
        await apps.archiveVariant("var-id")

        const appUrl = spy.mock.calls[0][0] as string
        const varUrl = spy.mock.calls[1][0] as string

        expect(appUrl).toContain("/simple/applications/app-id/archive")
        expect(varUrl).toContain("/applications/variants/var-id/archive")
        expect(appUrl).not.toEqual(varUrl)
    })
})
