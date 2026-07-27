import {QueryClient} from "@tanstack/react-query"
import {projectIdAtom} from "@agenta/shared/state"
import {createStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {beforeEach, describe, expect, it, vi} from "vitest"

const {querySessionMountsMock, queryMountFilesMock} = vi.hoisted(() => ({
    querySessionMountsMock: vi.fn(),
    queryMountFilesMock: vi.fn(),
}))

vi.mock("../../src/session/api/api", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/session/api/api")>()
    return {
        ...actual,
        querySessionMounts: querySessionMountsMock,
        queryMountFiles: queryMountFilesMock,
    }
})

import {
    mountFilesQueryFamily,
    mountFilesQueryKey,
    revalidateSessionMountsAtom,
    sessionMountsQueryFamily,
    sessionMountsQueryKey,
} from "../../src/session/state/mounts"

const PROJECT_ID = "proj-1"
const SESSION_ID = "session-1"
const MOUNT = {id: "mount-1", slug: "cwd", name: null, session_id: SESSION_ID}

function makeStore() {
    const queryClient = new QueryClient()
    const store = createStore()
    store.set(queryClientAtom, queryClient)
    store.set(projectIdAtom, PROJECT_ID)
    return {store, queryClient}
}

async function waitForAssertion(assertion: () => void) {
    const startedAt = Date.now()
    let lastError: unknown
    while (Date.now() - startedAt < 2000) {
        try {
            assertion()
            return
        } catch (error) {
            lastError = error
            await new Promise((resolve) => setTimeout(resolve, 10))
        }
    }
    throw lastError
}

describe("session mounts store", () => {
    beforeEach(() => {
        querySessionMountsMock.mockReset()
        queryMountFilesMock.mockReset()
        sessionMountsQueryFamily.setShouldRemove(() => true)
        sessionMountsQueryFamily.setShouldRemove(null)
        mountFilesQueryFamily.setShouldRemove(() => true)
        mountFilesQueryFamily.setShouldRemove(null)
    })

    it("fetches a session's mounts and one file tree per mount, shared by key", async () => {
        querySessionMountsMock.mockResolvedValue([MOUNT])
        queryMountFilesMock.mockResolvedValue([{path: "notes.md", size: 12, is_folder: false}])
        const {store} = makeStore()

        const unsubMounts = store.sub(sessionMountsQueryFamily(SESSION_ID), () => {})
        const unsubFiles = store.sub(mountFilesQueryFamily({mountId: MOUNT.id}), () => {})
        try {
            await waitForAssertion(() => {
                expect(store.get(sessionMountsQueryFamily(SESSION_ID)).data).toEqual([MOUNT])
                expect(store.get(mountFilesQueryFamily({mountId: MOUNT.id})).data).toEqual([
                    {path: "notes.md", size: 12, is_folder: false},
                ])
            })
            expect(querySessionMountsMock).toHaveBeenCalledTimes(1)
            expect(queryMountFilesMock).toHaveBeenCalledTimes(1)
        } finally {
            unsubMounts()
            unsubFiles()
        }
    })

    it("revalidate refetches ACTIVE queries and marks known mount files stale", async () => {
        querySessionMountsMock.mockResolvedValue([MOUNT])
        queryMountFilesMock.mockResolvedValue([])
        const {store, queryClient} = makeStore()

        const unsubMounts = store.sub(sessionMountsQueryFamily(SESSION_ID), () => {})
        const unsubFiles = store.sub(mountFilesQueryFamily({mountId: MOUNT.id}), () => {})
        try {
            await waitForAssertion(() => {
                expect(store.get(sessionMountsQueryFamily(SESSION_ID)).data).toEqual([MOUNT])
                expect(store.get(mountFilesQueryFamily({mountId: MOUNT.id})).data).toEqual([])
            })

            // The turn wrote a file; the next fetch returns it.
            queryMountFilesMock.mockResolvedValue([{path: "new.txt", size: 1, is_folder: false}])
            store.set(revalidateSessionMountsAtom, SESSION_ID)

            await waitForAssertion(() => {
                expect(store.get(mountFilesQueryFamily({mountId: MOUNT.id})).data).toEqual([
                    {path: "new.txt", size: 1, is_folder: false},
                ])
            })
            expect(querySessionMountsMock).toHaveBeenCalledTimes(2)
            expect(queryMountFilesMock).toHaveBeenCalledTimes(2)
        } finally {
            unsubMounts()
            unsubFiles()
        }

        // Inactive after unsubscribe: revalidating again marks stale without refetching now...
        const callsBefore = queryMountFilesMock.mock.calls.length
        store.set(revalidateSessionMountsAtom, SESSION_ID)
        await new Promise((resolve) => setTimeout(resolve, 50))
        expect(queryMountFilesMock).toHaveBeenCalledTimes(callsBefore)
        expect(
            queryClient.getQueryState(mountFilesQueryKey(PROJECT_ID, MOUNT.id))?.isInvalidated,
        ).toBe(true)
        expect(
            queryClient.getQueryState(sessionMountsQueryKey(PROJECT_ID, SESSION_ID))?.isInvalidated,
        ).toBe(true)

        // ...and the next subscriber (re-expanding the drive) refetches.
        const unsubAgain = store.sub(mountFilesQueryFamily({mountId: MOUNT.id}), () => {})
        try {
            await waitForAssertion(() => {
                expect(queryMountFilesMock.mock.calls.length).toBeGreaterThan(callsBefore)
            })
        } finally {
            unsubAgain()
        }
    })
})
