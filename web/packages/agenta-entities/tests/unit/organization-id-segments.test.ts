/**
 * CodeQL flagged both request URLs below as js/request-forgery: an organization, workspace or
 * project id that carried `../`, `?`, `#` or a whole second URL would move the request off the
 * endpoint the caller meant to hit. Each id now passes an allow-list before it reaches the URL.
 */
import {beforeEach, describe, expect, it, vi} from "vitest"

const get = vi.fn()
const post = vi.fn()

vi.mock("@agenta/shared/api", () => ({
    axios: {get, post},
    getAgentaApiUrl: () => "https://api.example.test",
}))

vi.mock("@agenta/shared/state", async () => {
    const {atom} = await import("jotai")
    return {projectIdAtom: atom("")}
})

const {fetchSingleOrg} = await import("../../src/organization/api")
const {acceptWorkspaceInvite} = await import("../../src/organization/workspaceApi")
const {isSafeIdSegment, toSafeIdSegment} = await import("../../src/organization/idSegments")

/** Ids the endpoints really see, and the shapes that redirect the request somewhere else. */
const ACCEPTED = [
    "0197e0f9-6f37-7b3b-9b1e-1b0f0e1a2b3c",
    "org-1",
    "workspace_2",
    "65d0f1a2b3c4d5e6f7a8b9c0",
    "ABC123",
]
const REJECTED = [
    "",
    "..",
    "../../auth/keys",
    "org/../../admin",
    "org?x=1",
    "org#frag",
    "org%2f..",
    "https://evil.example.com",
    "//evil.example.com",
    "evil.example.com",
    "org id",
    "org\nid",
    "org:1",
    "org@host",
]

describe("isSafeIdSegment", () => {
    it("accepts the id shapes these endpoints serve", () => {
        for (const id of ACCEPTED) expect({id, safe: isSafeIdSegment(id)}).toEqual({id, safe: true})
    })

    it("rejects every shape that would move the request", () => {
        for (const id of REJECTED)
            expect({id, safe: isSafeIdSegment(id)}).toEqual({id, safe: false})
    })
})

describe("toSafeIdSegment", () => {
    it("returns a real id unchanged", () => {
        for (const id of ACCEPTED) expect(toSafeIdSegment(id)).toBe(id)
    })

    it("answers null for every shape that would move the request", () => {
        for (const id of REJECTED)
            expect({id, segment: toSafeIdSegment(id)}).toEqual({id, segment: null})
    })

    it("keeps the literal undefined the invite page has always sent", () => {
        expect(toSafeIdSegment(undefined as unknown as string)).toBe("undefined")
    })
})

describe("fetchSingleOrg", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("builds the same request it always did for a real id", async () => {
        get.mockResolvedValueOnce({data: {id: "org-1"}})

        await expect(fetchSingleOrg({organizationId: "org-1"})).resolves.toEqual({id: "org-1"})
        expect(get).toHaveBeenCalledWith("https://api.example.test/organizations/org-1")
    })

    it("never issues the request for an id that would redirect it", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined)

        for (const id of REJECTED) {
            await expect(fetchSingleOrg({organizationId: id})).resolves.toBeNull()
        }

        expect(get).not.toHaveBeenCalled()
        error.mockRestore()
    })
})

describe("acceptWorkspaceInvite", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("builds the same request it always did for real ids", async () => {
        post.mockResolvedValueOnce({data: {ok: true}})

        await expect(
            acceptWorkspaceInvite({
                token: "tok",
                organizationId: "org-1",
                workspaceId: "ws-1",
                projectId: "proj-1",
            }),
        ).resolves.toEqual({ok: true})
        expect(post.mock.calls[0][0]).toBe(
            "https://api.example.test/organizations/org-1/workspaces/ws-1/invite/accept?project_id=proj-1",
        )
    })

    it("keeps interpolating an absent invite parameter as before", async () => {
        // The page passes `workspaceId as string` for invites that carry no workspace, and the URL
        // has always contained the literal `undefined` in that slot.
        post.mockResolvedValueOnce({data: {ok: true}})

        await acceptWorkspaceInvite({
            token: "tok",
            organizationId: "org-1",
            workspaceId: undefined as unknown as string,
            projectId: "proj-1",
        })
        expect(post.mock.calls[0][0]).toBe(
            "https://api.example.test/organizations/org-1/workspaces/undefined/invite/accept?project_id=proj-1",
        )
    })

    it("never issues the request when an invite id would redirect it", async () => {
        for (const id of REJECTED) {
            await expect(
                acceptWorkspaceInvite({
                    token: "tok",
                    organizationId: id,
                    workspaceId: "ws-1",
                    projectId: "proj-1",
                }),
            ).rejects.toThrow("Invalid organization id in the invite")
            await expect(
                acceptWorkspaceInvite({
                    token: "tok",
                    organizationId: "org-1",
                    workspaceId: id,
                    projectId: "proj-1",
                }),
            ).rejects.toThrow("Invalid workspace id in the invite")
            await expect(
                acceptWorkspaceInvite({
                    token: "tok",
                    organizationId: "org-1",
                    workspaceId: "ws-1",
                    projectId: id,
                }),
            ).rejects.toThrow("Invalid project id in the invite")
        }

        expect(post).not.toHaveBeenCalled()
    })
})
