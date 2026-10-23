import {describe, expect, it} from "vitest"

import {
    accessPolicySchema,
    agentSharingResponseSchema,
    sessionSharingResponseSchema,
    sharingKeys,
    sharingMembersResponseSchema,
} from "../../src/sharing"

const ALICE = "0190a3c4-0000-7000-8000-00000000a11c"
const BOB = "0190a3c4-0000-7000-8000-000000000b0b"
const STREAM = "0190a3c4-0000-7000-8000-0000000057e1"

describe("sharing schemas", () => {
    it("parses an agent sharing response and keeps unknown fields out", () => {
        const wire = {
            count: 1,
            sharing: {
                policy: {visibility: "private", owner_user_id: ALICE, extra_policy: 1},
                owner_is_active: true,
                my_role: "owner",
                can_take_ownership: false,
                unknown_state_field: "x",
            },
            disclosure: {
                connections: [
                    {
                        provider: "composio",
                        integration: "github",
                        connection: "my-github",
                        secret: "do-not-keep",
                    },
                ],
                turns_use_run_credentials: true,
                files_and_tool_results_shared: true,
                trace_readers_can_read: true,
            },
            unknown_top_level: true,
        }

        const parsed = agentSharingResponseSchema.parse(wire)

        expect(parsed).toEqual({
            count: 1,
            sharing: {
                policy: {visibility: "private", owner_user_id: ALICE},
                owner_is_active: true,
                my_role: "owner",
                can_take_ownership: false,
            },
            disclosure: {
                connections: [{provider: "composio", integration: "github", connection: "my-github"}],
                turns_use_run_credentials: true,
                files_and_tool_results_shared: true,
                trace_readers_can_read: true,
            },
        })
    })

    it("parses a session sharing response with grants and a null disclosure", () => {
        const parsed = sessionSharingResponseSchema.parse({
            count: 1,
            sharing: {
                policy: {visibility: "private", owner_user_id: ALICE},
                owner_is_active: true,
                grants: [
                    {
                        stream_id: STREAM,
                        user_id: BOB,
                        role: "participant",
                        created_at: "2026-10-22T10:00:00Z",
                        created_by_id: ALICE,
                    },
                ],
                my_role: "owner",
                can_send: true,
                shareable: true,
            },
            disclosure: null,
        })

        expect(parsed.disclosure).toBeNull()
        expect(parsed.sharing.grants[0]?.role).toBe("participant")
    })

    it("parses a members response with an optional windowing", () => {
        const parsed = sharingMembersResponseSchema.parse({
            count: 1,
            members: [{user_id: BOB, email: "bob@example.com", name: null, role: "editor"}],
        })

        expect(parsed.members[0]?.name).toBeNull()
        expect(parsed.windowing).toBeUndefined()
    })

    it("rejects a private policy without an owner", () => {
        expect(accessPolicySchema.safeParse({visibility: "private"}).success).toBe(false)
        expect(
            accessPolicySchema.safeParse({visibility: "private", owner_user_id: null}).success,
        ).toBe(false)
        expect(accessPolicySchema.safeParse({visibility: "project"}).success).toBe(true)
        expect(
            accessPolicySchema.safeParse({visibility: "private", owner_user_id: ALICE}).success,
        ).toBe(true)
    })
})

describe("sharingKeys", () => {
    it("query keys include the project id", () => {
        expect(sharingKeys.agent("wf-1", "proj-1")).toEqual(["sharing", "agent", "wf-1", "proj-1"])
        expect(sharingKeys.session("s-1", "proj-1")).toEqual([
            "sharing",
            "session",
            "s-1",
            "proj-1",
        ])
        expect(sharingKeys.members("proj-1", "bo")).toEqual(["sharing", "members", "proj-1", "bo"])

        expect(sharingKeys.agent("wf-1", "proj-1").at(-1)).toBe("proj-1")
        expect(sharingKeys.session("s-1", "proj-1").at(-1)).toBe("proj-1")
        expect(sharingKeys.members("proj-1", "bo")[2]).toBe("proj-1")
    })
})
