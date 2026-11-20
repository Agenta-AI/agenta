// @vitest-environment jsdom
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"

const state = vi.hoisted(() => ({
    connections: [] as {id: string; kind: string}[],
    vault: {isPending: false, isFetching: false, isError: false, data: [] as unknown} as Record<
        string,
        unknown
    >,
}))

vi.mock("@agenta/entities/secret", () => ({
    providerConnectionsAtom: "connections",
    vaultSecretsQueryAtom: "vault",
    isOrganizationConnection: () => false,
}))
vi.mock("jotai", () => ({
    useAtomValue: (atom: string) => (atom === "connections" ? state.connections : state.vault),
}))
vi.mock("@agenta/entity-ui/secretProvider", () => ({
    providerConnectionView: {id: "form"},
    providerListView: {id: "list"},
}))
vi.mock("@agenta/ui/view-stack", () => ({
    ViewDrawerHost: ({request}: {request: {view: {id: string}; params: unknown}}) => (
        <div role="dialog">{`${request.view.id} ${JSON.stringify(request.params)}`}</div>
    ),
}))

import {RunErrorProviderDrawer} from "@/features/chat/RunErrorProviderDrawer"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let root: Root | undefined
let host: HTMLDivElement | undefined

const render = () => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    act(() =>
        root!.render(
            <RunErrorProviderDrawer open onClose={() => undefined} providerKind="openai" />,
        ),
    )
    return host.querySelector('[role="dialog"]')?.textContent ?? null
}

afterEach(() => {
    if (root) act(() => root!.unmount())
    host?.remove()
    state.connections = []
    state.vault = {isPending: false, isFetching: false, isError: false, data: []}
})

describe("RunErrorProviderDrawer", () => {
    it("opens the provider's own connection when the project has one", () => {
        state.connections = [{id: "conn-1", kind: "openai"}]
        expect(render()).toBe('form {"kind":"openai","connectionId":"conn-1"}')
    })

    it("waits while the vault is loading, so it does not open a new form too early", () => {
        state.vault = {isPending: true, isFetching: true, isError: false, data: undefined}
        expect(render()).toBeNull()
    })

    it("opens a new form only after a lookup that found no connection", () => {
        expect(render()).toBe('form {"kind":"openai"}')
    })

    it("keeps the open form while the vault refreshes after a save", () => {
        expect(render()).toBe('form {"kind":"openai"}')
        state.vault = {isPending: false, isFetching: true, isError: false, data: []}
        act(() =>
            root!.render(
                <RunErrorProviderDrawer open onClose={() => undefined} providerKind="openai" />,
            ),
        )
        expect(host!.querySelector('[role="dialog"]')?.textContent).toBe('form {"kind":"openai"}')
    })

    it("opens the provider list, with its Try again, when the vault cannot be read", () => {
        state.vault = {isPending: false, isFetching: false, isError: true, data: undefined}
        expect(render()).toBe("list {}")
    })
})
