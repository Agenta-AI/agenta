/**
 * Drives in the session files pane: the configuration's `drives` entries, resolved by slug through
 * `POST /mounts/query`. The home drive folds in once under `agent-files/`, every other drive under
 * `drives/<slug>/`; a configuration without `drives` keeps the lookup by the agent id.
 */
import {projectIdAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {createStore, type Atom} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {beforeEach, describe, expect, it, vi} from "vitest"

const fern = vi.hoisted(() => ({queryMounts: vi.fn(), queryAgentMount: vi.fn()}))

vi.mock("@agenta/sdk/resources", () => ({
    getMountsClient: () => fern,
    getLowPriorityMountsClient: () => fern,
    getSessionsClient: () => ({}),
    getLowPrioritySessionsClient: () => ({}),
}))

import {
    agentDriveConfig,
    agentDrivesStateForParameters,
    matchDrives,
    resolveDrivePath,
    type AgentDrivesState,
} from "../../src/drive/drives"
import {message} from "@agenta/ui/app-message"

import {canWriteAt, DRIVE_NOT_WRITABLE, ensureWritable} from "../../src/drive/useDriveUploads"
import {
    driveHasMixedOrigins,
    fileOrigin,
    isListableDrivePath,
    isReadableToolPath,
    presentToolPath,
    resolveDriveMount,
    summarizeDrives,
} from "../../src/drive/useSessionDrive"
import {queryMountsBySlugs} from "../../src/session/api/api"
import {prepareCommitParameters} from "../../src/workflow/state/createPayload"
import type {Workflow} from "../../src/workflow/core"

beforeEach(() => {
    fern.queryMounts.mockReset()
    fern.queryAgentMount.mockReset()
})

describe("agentDriveConfig", () => {
    it("reads the entries of parameters.agent.drives, read-write by default, and the home", () => {
        const parameters = {
            agent: {
                drives: [{slug: "quote-agent-files"}, {slug: "price-lists", access: "read"}],
                home_drive: "quote-agent-files",
            },
        }
        expect(agentDriveConfig(parameters)).toEqual({
            entries: [
                {slug: "quote-agent-files", access: "read-write"},
                {slug: "price-lists", access: "read"},
            ],
            homeSlug: "quote-agent-files",
        })
    })

    it("is null without a drives list: the agent's drive is found by its id", () => {
        expect(agentDriveConfig(null)).toBeNull()
        expect(agentDriveConfig({agent: {}})).toBeNull()
        expect(agentDriveConfig({agent: {has_session_drive: true}})).toBeNull()
    })

    it("has no home for a null or unknown home_drive, and skips malformed or repeated entries", () => {
        expect(agentDriveConfig({agent: {drives: [], home_drive: null}})).toEqual({
            entries: [],
            homeSlug: null,
        })
        expect(
            agentDriveConfig({
                agent: {
                    drives: [null, {}, {slug: ""}, {slug: "a"}, {slug: "a", access: "read"}],
                    home_drive: "missing",
                },
            }),
        ).toEqual({entries: [{slug: "a", access: "read-write"}], homeSlug: null})
    })
})

async function settle(target: Atom<AgentDrivesState>): Promise<AgentDrivesState> {
    const store = createStore()
    store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
    store.set(projectIdAtom, "p1")
    const unsub = store.sub(target, () => undefined)
    await vi.waitFor(() => expect(store.get(target).isPending).toBe(false))
    const value = store.get(target)
    unsub()
    return value
}

describe("agentDrivesStateForParameters", () => {
    const home = {id: "m-home", slug: "quote-agent-files"}
    const prices = {id: "m-prices", slug: "price-lists"}

    it("shows the home drive once, as home, and every other drive under drives/", async () => {
        fern.queryMounts.mockResolvedValue({count: 2, mounts: [prices, home]})
        const state = await settle(
            agentDrivesStateForParameters(
                {
                    agent: {
                        drives: [
                            {slug: "quote-agent-files"},
                            {slug: "price-lists", access: "read"},
                        ],
                        home_drive: "quote-agent-files",
                    },
                },
                "a-home",
            ),
        )
        expect(fern.queryMounts.mock.calls[0][0]).toEqual({
            mount: {slugs: ["quote-agent-files", "price-lists"]},
        })
        expect(state.homeMount).toEqual(home)
        expect(state.homeSlug).toBe("quote-agent-files")
        expect(state.otherDrives).toEqual([{slug: "price-lists", access: "read", mount: prices}])
        expect(state.linked.map((d) => d.slug)).toEqual(["quote-agent-files", "price-lists"])
        expect(fern.queryAgentMount).not.toHaveBeenCalled()
    })

    // A missing drive, or a private drive the viewer may not use, does not come back.
    it("does not show a slug that does not resolve", async () => {
        fern.queryMounts.mockResolvedValue({count: 1, mounts: [prices]})
        const state = await settle(
            agentDrivesStateForParameters(
                {
                    agent: {
                        drives: [{slug: "quote-agent-files"}, {slug: "price-lists"}],
                        home_drive: "quote-agent-files",
                    },
                },
                "a-unresolved",
            ),
        )
        expect(state.homeMount).toBeNull()
        expect(state.otherDrives.map((d) => d.slug)).toEqual(["price-lists"])
        expect(state.entries.map((d) => d.slug)).toEqual(["quote-agent-files", "price-lists"])
    })

    it("has no home and sends no request for an empty list", async () => {
        const state = await settle(
            agentDrivesStateForParameters({agent: {drives: [], home_drive: null}}, "a-none"),
        )
        expect(state).toMatchObject({homeMount: null, otherDrives: [], entries: []})
        expect(fern.queryMounts).not.toHaveBeenCalled()
        expect(fern.queryAgentMount).not.toHaveBeenCalled()
    })

    it("finds the home drive by the agent id for a configuration without drives", async () => {
        fern.queryAgentMount.mockResolvedValue({count: 1, mounts: [{id: "m-own", slug: "own"}]})
        const state = await settle(
            agentDrivesStateForParameters({agent: {has_session_drive: true}}, "a-legacy"),
        )
        expect(fern.queryAgentMount.mock.calls[0][0]).toEqual({artifact_id: "a-legacy"})
        expect(state.homeMount).toEqual({id: "m-own", slug: "own"})
        expect(state.otherDrives).toEqual([])
        expect(fern.queryMounts).not.toHaveBeenCalled()
    })

    it("is pending while the configuration loads, and asks nothing", () => {
        const store = createStore()
        expect(store.get(agentDrivesStateForParameters(undefined, "a-pending")).isPending).toBe(
            true,
        )
        expect(fern.queryAgentMount).not.toHaveBeenCalled()
    })
})

describe("matchDrives", () => {
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
        expect(matchDrives(entries, mounts)).toEqual([
            {slug: "b", access: "read", mount: {id: "m-b", slug: "b"}},
            {slug: "a", access: "read-write", mount: {id: "m-a", slug: "a"}},
        ])
    })
})

describe("resolveDrivePath", () => {
    const drives = [{slug: "price-lists"}, {slug: "price"}]

    it("maps a path under drives/<slug>/ to that drive, by whole segment", () => {
        expect(resolveDrivePath("drives/price-lists/2026.md", drives)).toEqual({
            drive: {slug: "price-lists"},
            path: "2026.md",
        })
        expect(resolveDrivePath("/drives/price/a/b.md", drives)).toEqual({
            drive: {slug: "price"},
            path: "a/b.md",
        })
        expect(resolveDrivePath("drives/price-lists", drives)).toEqual({
            drive: {slug: "price-lists"},
            path: "",
        })
    })

    it("answers null outside a known drive", () => {
        expect(resolveDrivePath("drives/other/x.md", drives)).toBeNull()
        expect(resolveDrivePath("notes/drives/price/x.md", drives)).toBeNull()
        expect(resolveDrivePath("drives", drives)).toBeNull()
    })
})

describe("fileOrigin", () => {
    const drives = [{slug: "price-lists"}]

    it("tells the three origins apart", () => {
        expect(fileOrigin("notes/a.md", drives)).toBe("session")
        expect(fileOrigin("agent-files/a.md", drives)).toBe("home")
        expect(fileOrigin("drives/price-lists/2026.md", drives)).toBe("drive")
        expect(fileOrigin("drives/price-lists", drives)).toBe("drive")
        expect(fileOrigin("drives", drives)).toBe("session")
    })

    // Only a configured slug is a drive; anything else under `drives/` is a session file.
    it("keeps other paths under drives/ as session files, drives/README.md included", () => {
        expect(fileOrigin("drives/README.md", drives)).toBe("session")
        expect(isListableDrivePath("drives/README.md", {drives})).toBe(true)
        expect(fileOrigin("drives/notes.md", drives)).toBe("session")
        expect(fileOrigin("drives/other/x.md", drives)).toBe("session")
        expect(fileOrigin("drives/price-lists/2026.md")).toBe("session")
    })

    it("counts drive files as durable when mixed with session files", () => {
        const ab = [{slug: "a"}]
        expect(
            driveHasMixedOrigins([{path: "drives/a/x.md"}, {path: "agent-files/y.md"}], ab),
        ).toBe(false)
        expect(driveHasMixedOrigins([{path: "drives/a/x.md"}, {path: "notes.md"}], ab)).toBe(true)
    })
})

describe("summarizeDrives", () => {
    const lookup = {isPending: false, isFetching: false, isError: false}
    const ok = (total: number) => ({
        data: {total, totalCapped: false},
        isPending: false,
        isFetching: false,
        isError: false,
    })

    it("adds the drives' counts", () => {
        expect(summarizeDrives(lookup, [ok(2), ok(3)])).toMatchObject({
            fileCount: 5,
            errored: false,
            resolving: false,
        })
    })

    // A failed request answers null: that is a failure to flag and retry, not an empty drive.
    it("flags a failed count beside a drive that loaded", () => {
        const failed = {data: null, isPending: false, isFetching: false, isError: false}
        expect(summarizeDrives(lookup, [ok(2), failed])).toMatchObject({
            fileCount: 2,
            errored: true,
        })
    })

    it("flags a failed slug lookup, and a pending one as resolving", () => {
        expect(summarizeDrives({...lookup, isError: true}, []).errored).toBe(true)
        expect(summarizeDrives({...lookup, isPending: true}, []).resolving).toBe(true)
    })
})

describe("canWriteAt", () => {
    const mount = {id: "m"}
    const drive = {
        resolveMount: (path: string) =>
            path.startsWith("drives/prices")
                ? {mount, path: "", readOnly: true}
                : path.startsWith("drives/team")
                  ? {mount, path: ""}
                  : null,
    }

    it("writes where a writable mount backs the folder, even with no session mount", () => {
        expect(canWriteAt(drive, "drives/team")).toBe(true)
        expect(canWriteAt(drive, "drives/prices")).toBe(false)
        expect(canWriteAt(drive, "")).toBe(false)
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
    it("keeps drives, home_drive and has_session_drive when an agent configuration is saved", () => {
        const agent = {
            has_session_drive: true,
            drives: [{slug: "quote-agent-files"}, {slug: "price-lists", access: "read"}],
            home_drive: "quote-agent-files",
        }
        const entity = {id: "r1", data: {parameters: {agent}}} as unknown as Workflow
        expect(prepareCommitParameters(entity, null)).toEqual({agent})
    })
})

describe("ensureWritable", () => {
    const drive = {
        resolveMount: (path: string) =>
            path.startsWith("drives/prices") ? {mount: {id: "m"}, path: "", readOnly: true} : null,
    }

    it("refuses a drop onto a read drive with the pane's one refusal message", () => {
        vi.mocked(message.error).mockClear()
        expect(ensureWritable(drive, "drives/prices")).toBe(false)
        expect(message.error).toHaveBeenCalledWith(DRIVE_NOT_WRITABLE)
        expect(DRIVE_NOT_WRITABLE).toBe("This location can't be written to")
    })
})

describe("resolveDriveMount", () => {
    const prices = {slug: "prices", access: "read" as const, mount: {id: "m-prices"}}

    it("maps a resolved drive's path to its mount, read-only for a read drive", () => {
        expect(resolveDriveMount("drives/prices/a.txt", [prices])).toEqual({
            mount: prices.mount,
            path: "a.txt",
            readOnly: true,
        })
    })

    // While the lookup is pending or failed, a configured path must not fall back to the session
    // folder, where it would look writable.
    it("gives no target for a configured drive whose mount is not resolved", () => {
        expect(resolveDriveMount("drives/prices/a.txt", [], [{slug: "prices"}])).toBeNull()
    })

    it("is undefined for a path outside every configured drive", () => {
        expect(resolveDriveMount("drives/other/a.txt", [], [{slug: "prices"}])).toBeUndefined()
        expect(resolveDriveMount("notes.md", [prices])).toBeUndefined()
    })
})

describe("the home drive's link under drives/", () => {
    const home = {slug: "quote-agent-files", access: "read-write" as const, mount: {id: "m-home"}}
    const configured = [{slug: "quote-agent-files"}, {slug: "price-lists"}]

    // The pane hides `drives/<home>`, but a link to it still opens the home drive's file.
    it("resolves a path under drives/<home>/ to the home drive", () => {
        expect(resolveDriveMount("drives/quote-agent-files/a.md", [home], configured)).toEqual({
            mount: home.mount,
            path: "a.md",
            readOnly: false,
        })
    })

    it("is a link marker in the session folder, never a session file", () => {
        expect(isListableDrivePath("drives/quote-agent-files", {drives: configured})).toBe(false)
        expect(isListableDrivePath("drives/price-lists", {drives: configured})).toBe(false)
    })
})

describe("presentToolPath", () => {
    it("presents the home drive under agent-files/ and other drives under drives/<slug>/", () => {
        const home = {origin: "drive" as const, slug: "quote-agent-files", path: "a.md"}
        const prices = {origin: "drive" as const, slug: "price-lists", path: "b.csv"}
        expect(presentToolPath(home, "quote-agent-files")).toBe("agent-files/a.md")
        expect(presentToolPath(prices, "quote-agent-files")).toBe("drives/price-lists/b.csv")
        expect(presentToolPath({origin: "agent", path: "c.md"})).toBe("agent-files/c.md")
        expect(presentToolPath({origin: "session", path: "d.md"})).toBe("d.md")
    })

    it("presents the home drive reached through the session folder's link under agent-files/", () => {
        const viaLink = {origin: "session" as const, path: "drives/quote-agent-files/a.md"}
        expect(presentToolPath(viaLink, "quote-agent-files")).toBe("agent-files/a.md")
        expect(presentToolPath(viaLink, "quote-agent-files", "")).toBe("a.md")
        expect(
            presentToolPath(
                {origin: "session", path: "drives/price-lists/b.csv"},
                "quote-agent-files",
            ),
        ).toBe("drives/price-lists/b.csv")
    })
})

describe("isReadableToolPath", () => {
    const team = {slug: "team", access: "read-write" as const, mount: {id: "m-team"} as never}
    const entries = [{slug: "team"}, {slug: "prices"}]

    it("drops a write into a configured drive that has no mount", () => {
        expect(
            isReadableToolPath({origin: "drive", slug: "prices", path: "a.md"}, [team], entries),
        ).toBe(false)
        expect(
            isReadableToolPath({origin: "session", path: "drives/prices/a.md"}, [team], entries),
        ).toBe(false)
    })

    it("keeps a write into a mounted drive, the session or the older agent mount", () => {
        expect(
            isReadableToolPath({origin: "drive", slug: "team", path: "a.md"}, [team], entries),
        ).toBe(true)
        expect(
            isReadableToolPath({origin: "session", path: "drives/team/a.md"}, [team], entries),
        ).toBe(true)
        expect(isReadableToolPath({origin: "session", path: "notes/a.md"}, [team], entries)).toBe(
            true,
        )
        expect(isReadableToolPath({origin: "agent", path: "a.md"}, [], entries)).toBe(true)
    })
})
