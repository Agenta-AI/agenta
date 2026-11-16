/**
 * Project drives in the session files pane: the configuration's `{kind: "project"}` entries,
 * resolved by slug through `POST /mounts/query`, fold in under `drives/<slug>/` as a third origin.
 */
import {beforeEach, describe, expect, it, vi} from "vitest"

const fern = vi.hoisted(() => ({queryMounts: vi.fn()}))

vi.mock("@agenta/sdk/resources", () => ({
    getMountsClient: () => fern,
    getLowPriorityMountsClient: () => fern,
    getSessionsClient: () => ({}),
    getLowPrioritySessionsClient: () => ({}),
}))

import {
    matchProjectDrives,
    projectDriveEntries,
    resolveProjectDrivePath,
} from "../../src/drive/projectDrives"
import {driveHasMixedOrigins, fileOrigin} from "../../src/drive/useSessionDrive"
import {queryMountsBySlugs} from "../../src/session/api/api"
import {prepareCommitParameters} from "../../src/workflow/state/createPayload"
import type {Workflow} from "../../src/workflow/core"

beforeEach(() => {
    fern.queryMounts.mockReset()
})

describe("projectDriveEntries", () => {
    it("reads the project entries of parameters.agent.drives, read-write by default", () => {
        const parameters = {
            agent: {
                drives: [
                    {kind: "agent"},
                    {kind: "project", slug: "price-lists", access: "read"},
                    {kind: "project", slug: "team-notes"},
                ],
            },
        }
        expect(projectDriveEntries(parameters)).toEqual([
            {slug: "price-lists", access: "read"},
            {slug: "team-notes", access: "read-write"},
        ])
    })

    it("is empty without a drives list, and skips malformed or repeated entries", () => {
        expect(projectDriveEntries(null)).toEqual([])
        expect(projectDriveEntries({agent: {}})).toEqual([])
        expect(
            projectDriveEntries({
                agent: {
                    drives: [
                        null,
                        {kind: "project"},
                        {kind: "project", slug: ""},
                        {kind: "project", slug: "a"},
                        {kind: "project", slug: "a", access: "read"},
                    ],
                },
            }),
        ).toEqual([{slug: "a", access: "read-write"}])
    })
})

describe("matchProjectDrives", () => {
    it("keeps each entry whose slug has an active mount, in configuration order", () => {
        const entries = [
            {slug: "b", access: "read" as const},
            {slug: "gone", access: "read-write" as const},
            {slug: "a", access: "read-write" as const},
        ]
        const mounts = [
            {id: "m-a", slug: "a"},
            {id: "m-b", slug: "b"},
        ]
        expect(matchProjectDrives(entries, mounts)).toEqual([
            {slug: "b", access: "read", mount: {id: "m-b", slug: "b"}},
            {slug: "a", access: "read-write", mount: {id: "m-a", slug: "a"}},
        ])
    })
})

describe("resolveProjectDrivePath", () => {
    const drives = [{slug: "price-lists"}, {slug: "price"}]

    it("maps a path under drives/<slug>/ to that drive, by whole segment", () => {
        expect(resolveProjectDrivePath("drives/price-lists/2026.md", drives)).toEqual({
            drive: {slug: "price-lists"},
            path: "2026.md",
        })
        expect(resolveProjectDrivePath("/drives/price/a/b.md", drives)).toEqual({
            drive: {slug: "price"},
            path: "a/b.md",
        })
        expect(resolveProjectDrivePath("drives/price-lists", drives)).toEqual({
            drive: {slug: "price-lists"},
            path: "",
        })
    })

    it("answers null outside a known drive", () => {
        expect(resolveProjectDrivePath("drives/other/x.md", drives)).toBeNull()
        expect(resolveProjectDrivePath("notes/drives/price/x.md", drives)).toBeNull()
        expect(resolveProjectDrivePath("drives", drives)).toBeNull()
    })
})

describe("fileOrigin", () => {
    it("tells the three origins apart", () => {
        expect(fileOrigin("notes/a.md")).toBe("session")
        expect(fileOrigin("agent-files/a.md")).toBe("agent")
        expect(fileOrigin("drives/price-lists/2026.md")).toBe("project")
        expect(fileOrigin("drives")).toBe("session")
    })

    it("counts project files as durable when mixed with session files", () => {
        expect(driveHasMixedOrigins([{path: "drives/a/x.md"}, {path: "agent-files/y.md"}])).toBe(
            false,
        )
        expect(driveHasMixedOrigins([{path: "drives/a/x.md"}, {path: "notes.md"}])).toBe(true)
    })
})

describe("queryMountsBySlugs", () => {
    it("filters POST /mounts/query by slugs and validates the answer", async () => {
        fern.queryMounts.mockResolvedValueOnce({
            count: 1,
            mounts: [{id: "m1", slug: "price-lists", name: "Price lists"}],
        })
        const mounts = await queryMountsBySlugs({slugs: ["price-lists"], projectId: "p1"})
        expect(mounts).toEqual([{id: "m1", slug: "price-lists", name: "Price lists"}])
        const [body, options] = fern.queryMounts.mock.calls[0]
        expect(body).toEqual({mount: {slugs: ["price-lists"]}})
        expect(options.queryParams).toEqual({project_id: "p1"})
    })

    it("sends no request without slugs", async () => {
        expect(await queryMountsBySlugs({slugs: [], projectId: "p1"})).toBeNull()
        expect(fern.queryMounts).not.toHaveBeenCalled()
    })
})

describe("prepareCommitParameters", () => {
    it("keeps drives and has_session_drive when an agent configuration is saved", () => {
        const agent = {
            has_session_drive: true,
            drives: [{kind: "agent"}, {kind: "project", slug: "price-lists", access: "read"}],
        }
        const entity = {id: "r1", data: {parameters: {agent}}} as unknown as Workflow
        expect(prepareCommitParameters(entity, null)).toEqual({agent})
    })
})
