import {QueryClient} from "@tanstack/react-query"
import {projectIdAtom} from "@agenta/shared/state"
import {createStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {beforeEach, describe, expect, it, vi} from "vitest"

import {detectFileActivity, mountPathMatchesToolPath} from "../../src/session/core/fileActivity"
import {
    latestSessionFileActivityAtomFamily,
    recordFileActivityAtom,
    sessionFileActivityAtomFamily,
} from "../../src/session/state/fileActivity"
import {
    mountFileContentQueryKey,
    mountFilesQueryKey,
    sessionMountsQueryKey,
} from "../../src/session/state/mounts"

const PROJECT_ID = "proj-1"
const SESSION_ID = "session-1"
const MOUNT_ID = "mount-1"

describe("detectFileActivity", () => {
    it("matches harness write/edit/delete tools across vocabularies", () => {
        // Pi builtins
        expect(detectFileActivity("write", {path: "notes.md"})).toEqual({
            op: "write",
            path: "notes.md",
            toolName: "write",
        })
        expect(detectFileActivity("edit", {path: "a/b.ts"})?.op).toBe("edit")
        // Claude Code (case-insensitive, file_path key)
        expect(detectFileActivity("Write", {file_path: "/tmp/x/out.txt"})?.op).toBe("write")
        expect(detectFileActivity("MultiEdit", {file_path: "src/i.ts"})?.op).toBe("edit")
        expect(detectFileActivity("NotebookEdit", {notebook_path: "n.ipynb"})?.op).toBe("edit")
        // MCP tail matching
        expect(detectFileActivity("mcp__filesystem__write_file", {path: "f.md"})?.op).toBe("write")
        expect(detectFileActivity("delete_file", {path: "gone.md"})?.op).toBe("delete")
    })

    it("returns null for non-file tools, bash, and missing paths", () => {
        expect(detectFileActivity("bash", {command: "echo hi > f.txt"})).toBeNull()
        expect(detectFileActivity("read", {path: "f.txt"})).toBeNull()
        expect(detectFileActivity("write", {})).toBeNull()
        expect(detectFileActivity("tools__composio__github__COMMIT__c", {path: "x"})).toBeNull()
    })
})

describe("mountPathMatchesToolPath", () => {
    it("matches on tail with segment boundaries", () => {
        expect(mountPathMatchesToolPath("notes/a.md", "/tmp/agenta/x/notes/a.md")).toBe(true)
        expect(mountPathMatchesToolPath("notes/a.md", "notes/a.md")).toBe(true)
        expect(mountPathMatchesToolPath("notes/a.md", "/tmp/xnotes/a.md")).toBe(false)
        expect(mountPathMatchesToolPath("a.md", "/w/b.md")).toBe(false)
    })
})

describe("recordFileActivityAtom", () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        sessionFileActivityAtomFamily.setShouldRemove(() => true)
        sessionFileActivityAtomFamily.setShouldRemove(null)
    })

    function makeStore() {
        const queryClient = new QueryClient()
        const store = createStore()
        store.set(queryClientAtom, queryClient)
        store.set(projectIdAtom, PROJECT_ID)
        return {store, queryClient}
    }

    it("enriches from the drive cache: resolved location, effect, diff base; then invalidates", () => {
        const {store, queryClient} = makeStore()
        queryClient.setQueryData(sessionMountsQueryKey(PROJECT_ID, SESSION_ID), [
            {id: MOUNT_ID, slug: "cwd", name: null, session_id: SESSION_ID},
        ])
        queryClient.setQueryData(mountFilesQueryKey(PROJECT_ID, MOUNT_ID), [
            {path: "notes/a.md", size: 5, is_folder: false},
        ])
        queryClient.setQueryData(
            mountFileContentQueryKey(PROJECT_ID, MOUNT_ID, "notes/a.md"),
            "old body",
        )

        store.set(recordFileActivityAtom, {
            sessionId: SESSION_ID,
            toolCallId: "call-1",
            activity: {op: "edit", path: "/tmp/agenta/x/notes/a.md", toolName: "edit"},
        })

        const entry = store.get(latestSessionFileActivityAtomFamily(SESSION_ID))
        expect(entry).toMatchObject({
            toolCallId: "call-1",
            op: "edit",
            effect: "modified",
            resolved: {mountId: MOUNT_ID, path: "notes/a.md"},
            previousContent: "old body",
        })
        // Drive queries were marked stale (mid-stream revalidation).
        expect(
            queryClient.getQueryState(mountFilesQueryKey(PROJECT_ID, MOUNT_ID))?.isInvalidated,
        ).toBe(true)
        expect(
            queryClient.getQueryState(sessionMountsQueryKey(PROJECT_ID, SESSION_ID))?.isInvalidated,
        ).toBe(true)
    })

    it("derives created (listing cached, path absent) vs unknown (no listing) and dedupes", () => {
        const {store, queryClient} = makeStore()

        // No listing cached at all → unknown.
        store.set(recordFileActivityAtom, {
            sessionId: SESSION_ID,
            toolCallId: "call-a",
            activity: {op: "write", path: "brand-new.md", toolName: "write"},
        })
        expect(store.get(latestSessionFileActivityAtomFamily(SESSION_ID))?.effect).toBe("unknown")

        // Listing cached, path absent → created.
        queryClient.setQueryData(mountFilesQueryKey(PROJECT_ID, MOUNT_ID), [])
        store.set(recordFileActivityAtom, {
            sessionId: SESSION_ID,
            toolCallId: "call-b",
            activity: {op: "write", path: "brand-new.md", toolName: "write"},
        })
        expect(store.get(latestSessionFileActivityAtomFamily(SESSION_ID))?.effect).toBe("created")

        // Same toolCallId again → no duplicate entry.
        store.set(recordFileActivityAtom, {
            sessionId: SESSION_ID,
            toolCallId: "call-b",
            activity: {op: "write", path: "brand-new.md", toolName: "write"},
        })
        expect(store.get(sessionFileActivityAtomFamily(SESSION_ID))).toHaveLength(2)
    })
})
