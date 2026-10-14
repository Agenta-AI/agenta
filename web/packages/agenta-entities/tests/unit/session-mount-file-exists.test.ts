/**
 * A chat mention's existence check lists the PARENT folder (raw, one level) and never reads the
 * file's content: a mention of a large video must not download it (#7522).
 */
import {projectIdAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {createStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {beforeEach, describe, expect, it, vi} from "vitest"

const fern = vi.hoisted(() => ({getMountFiles: vi.fn()}))

vi.mock("@agenta/sdk/resources", () => ({
    getMountsClient: () => fern,
    getLowPriorityMountsClient: () => fern,
    getSessionsClient: () => ({}),
    getLowPrioritySessionsClient: () => ({}),
}))

import {mountFileExistsAtomFamily} from "../../src/session/state/mounts"

const MOUNT_ID = "m1"

function makeStore() {
    const store = createStore()
    store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
    store.set(projectIdAtom, "p1")
    return store
}

async function exists(store: ReturnType<typeof makeStore>, path: string) {
    const target = mountFileExistsAtomFamily({mountId: MOUNT_ID, path})
    const unsub = store.sub(target, () => undefined)
    await vi.waitFor(() => expect(store.get(target)).not.toBeNull())
    const value = store.get(target)
    unsub()
    return value
}

const readCalls = () =>
    fern.getMountFiles.mock.calls.filter(([request]) => request && "read" in request)

beforeEach(() => {
    fern.getMountFiles.mockReset()
})

describe("mountFileExistsAtomFamily", () => {
    it("finds clip.mp4 in its parent listing without a text read", async () => {
        fern.getMountFiles.mockResolvedValue({
            files: [
                {path: "media/clip.mp4", size: 55_000_000},
                {path: "media/sub/", is_folder: true},
            ],
        })
        const store = makeStore()

        expect(await exists(store, "media/clip.mp4")).toBe(true)
        expect(fern.getMountFiles).toHaveBeenCalledTimes(1)
        expect(fern.getMountFiles.mock.calls[0][0]).toEqual({
            mount_id: MOUNT_ID,
            path: "media",
            depth: 1,
        })
        expect(readCalls()).toHaveLength(0)
    })

    it("shares one listing across every mention in the same folder", async () => {
        fern.getMountFiles.mockResolvedValue({files: [{path: "media/clip.mp4"}]})
        const store = makeStore()

        expect(await exists(store, "media/clip.mp4")).toBe(true)
        expect(await exists(store, "media/other.md")).toBe(false)
        expect(fern.getMountFiles).toHaveBeenCalledTimes(1)
    })

    it("does not count a folder as a file", async () => {
        fern.getMountFiles.mockResolvedValue({files: [{path: "media/sub/", is_folder: true}]})

        expect(await exists(makeStore(), "media/sub")).toBe(false)
    })

    it("lists the mount root for a bare name", async () => {
        fern.getMountFiles.mockResolvedValue({files: [{path: "clip.mp4"}]})

        expect(await exists(makeStore(), "clip.mp4")).toBe(true)
        expect(fern.getMountFiles.mock.calls[0][0]).toEqual({
            mount_id: MOUNT_ID,
            path: undefined,
            depth: 1,
        })
    })

    it("answers false when the folder does not exist", async () => {
        fern.getMountFiles.mockRejectedValue(Object.assign(new Error("404"), {statusCode: 404}))

        expect(await exists(makeStore(), "missing/clip.mp4")).toBe(false)
        expect(readCalls()).toHaveLength(0)
    })
})
