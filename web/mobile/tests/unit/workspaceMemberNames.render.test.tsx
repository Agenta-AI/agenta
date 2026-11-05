// @vitest-environment jsdom
// "Created by" names the member: the screens bind the workspace members, and the package's user
// lookup reads them. Before, nothing bound the lookup, so every list showed a dash.
import {act, createElement} from "react"

import {UserAuthorLabel} from "@agenta/entities/shared/user"
import {activeUserIdAtom} from "@agenta/shared/state"
import {getDefaultStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {useBindWorkspaceMembers} from "@/features/members/useBindWorkspaceMembers"

vi.mock("next/router", () => ({useRouter: () => ({query: {workspace_id: "ws"}})}))
vi.mock("@/features/settings/useSettingsOrg", () => ({
    useSettingsOrg: () => ({
        org: {
            data: {
                default_workspace: {
                    members: [
                        {
                            user: {id: "u-1", username: "Sam Lee", email: "sam@example.com"},
                            roles: [],
                        },
                    ],
                },
            },
        },
    }),
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const Screen = () => {
    useBindWorkspaceMembers()
    return createElement(
        "p",
        null,
        createElement(UserAuthorLabel, {userId: "u-1", showYouLabel: true, fallback: "—"}),
    )
}

describe("member names", () => {
    let root: Root
    let host: HTMLDivElement
    const store = getDefaultStore()

    beforeEach(() => {
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
    })
    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    it("Created by shows the member's name, with (you) for the signed-in user", async () => {
        store.set(activeUserIdAtom, "u-1")
        await act(async () => root.render(createElement(Provider, {store}, createElement(Screen))))
        expect(host.textContent).toBe("Sam Lee (you)")
    })
})
