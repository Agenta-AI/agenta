// @vitest-environment jsdom
// The Members tab's role cell: who gets a picker, and what a role the plan no longer offers reads.
import type {WorkspaceMember} from "@agenta/entities/organization"
import {flushSync} from "react-dom"
import {createRoot} from "react-dom/client"
import {afterEach, describe, expect, it} from "vitest"

import {MemberRoleCell} from "@/features/settings/MemberRoleCell"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let root: ReturnType<typeof createRoot> | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
    if (root) flushSync(() => root!.unmount())
    root = undefined
    host?.remove()
    host = undefined
})

const member = (role: string, status: WorkspaceMember["user"]["status"] = "member") =>
    ({
        user: {id: "u-1", email: "a@example.com", username: "a", status, created_at: ""},
        roles: [{role_name: role, role_description: "", permissions: []}],
    }) as WorkspaceMember

const render = (
    props: Partial<Parameters<typeof MemberRoleCell>[0]> & {member: WorkspaceMember},
) => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    flushSync(() =>
        root!.render(
            <MemberRoleCell
                isOwner={false}
                offeredRoles={["admin", "member"]}
                canChange
                onChange={() => undefined}
                {...props}
            />,
        ),
    )
    return host
}

const picker = (shown: HTMLElement) => shown.querySelector('[aria-label="Role"]')

describe("MemberRoleCell", () => {
    it("gives a joined member a picker", () => {
        const shown = render({member: member("member")})

        expect(picker(shown)).not.toBeNull()
        expect(shown.textContent).toContain("Member")
    })

    it.each(["pending", "expired"] as const)(
        "shows a %s invitation's role as a label, since there is no membership to change",
        (status) => {
            const shown = render({member: member("admin", status)})

            expect(picker(shown)).toBeNull()
            expect(shown.textContent).toBe("Admin")
        },
    )

    it("shows the owner's role as a label", () => {
        const shown = render({member: member("owner"), isOwner: true})

        expect(picker(shown)).toBeNull()
        expect(shown.textContent).toBe("Owner")
    })

    it("shows a role the plan no longer offers instead of a blank picker", () => {
        const shown = render({member: member("editor")})

        expect(picker(shown)).not.toBeNull()
        expect(shown.textContent).toContain("Editor")
    })

    it("shows a label to a reader who may not change roles", () => {
        const shown = render({member: member("member"), canChange: false})

        expect(picker(shown)).toBeNull()
        expect(shown.textContent).toBe("Member")
    })
})
