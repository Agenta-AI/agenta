/**
 * What the Fern boundary LOGS.
 *
 * The playground console carried `[readMountFile] failed: Status code: 404` twice a session with
 * no visible symptom (#6349): `useRepoInfo` probes `.git/HEAD` to learn whether a mount folder is
 * a git repo, and on an ordinary folder the miss IS the answer. Noise like that buries the real
 * errors someone opens the console to find, so an expected status returns null silently.
 */
import {afterEach, describe, expect, it, vi} from "vitest"

import {callFern} from "../../src/session/api/client"

const notFound = () => Object.assign(new Error("Status code: 404"), {statusCode: 404})
const isNotFound = (error: unknown) => (error as {statusCode?: number} | null)?.statusCode === 404

afterEach(() => vi.restoreAllMocks())

describe("callFern", () => {
    it("logs a failure the caller did not mark as expected", async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {})

        await expect(
            callFern("[readMountFile]", () => Promise.reject(notFound())),
        ).resolves.toBeNull()
        expect(spy).toHaveBeenCalledOnce()
    })

    it("returns null without logging when the status is an expected answer", async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {})

        await expect(
            callFern("[readMountFile]", () => Promise.reject(notFound()), isNotFound),
        ).resolves.toBeNull()
        expect(spy).not.toHaveBeenCalled()
    })

    it("still logs a status the predicate does not claim", async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {})
        const serverError = Object.assign(new Error("Status code: 500"), {statusCode: 500})

        await expect(
            callFern("[readMountFile]", () => Promise.reject(serverError), isNotFound),
        ).resolves.toBeNull()
        expect(spy).toHaveBeenCalledOnce()
    })

    it("rethrows an abort so the query client cancels cleanly", async () => {
        const abort = new DOMException("aborted", "AbortError")

        await expect(
            callFern("[readMountFile]", () => Promise.reject(abort), isNotFound),
        ).rejects.toBe(abort)
    })
})
