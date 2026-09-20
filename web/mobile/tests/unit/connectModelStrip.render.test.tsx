// @vitest-environment jsdom
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"

vi.mock("@agenta/chat/components", () => ({
    RevealCollapse: ({open, children}: {open: boolean; children: React.ReactNode}) =>
        open ? <>{children}</> : null,
}))

vi.mock("@agenta/entities/secret", () => ({
    providerConnectionsAtom: Symbol("providerConnectionsAtom"),
    useVaultSecret: () => ({mutate: vi.fn()}),
}))

vi.mock("jotai", () => ({useAtomValue: () => []}))

vi.mock("@agenta/entity-ui/secretProvider", () => ({
    ProviderDrawer: ({open}: {open: boolean}) =>
        open ? <div role="dialog">Model providers</div> : null,
}))

vi.mock("@agenta/ui/ui", () => ({
    Button: ({children, ...props}: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
        <button {...props}>{children}</button>
    ),
}))

import {ConnectModelStrip} from "@/features/chat/ConnectModelStrip"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
    if (root) act(() => root!.unmount())
    host?.remove()
    root = undefined
    host = undefined
})

describe("ConnectModelStrip", () => {
    it("opens the provider catalog instead of the current provider key dialog", async () => {
        host = document.createElement("div")
        document.body.appendChild(host)
        root = createRoot(host)

        await act(async () => {
            root!.render(<ConnectModelStrip gateActive />)
        })

        const button = host.querySelector("button")
        expect(button?.textContent).toContain("Set up model providers")

        await act(async () => {
            button?.dispatchEvent(new MouseEvent("click", {bubbles: true}))
        })

        expect(host.querySelector('[role="dialog"]')?.textContent).toBe("Model providers")
        expect(host.textContent).not.toContain("OpenAI API key")
    })
})
