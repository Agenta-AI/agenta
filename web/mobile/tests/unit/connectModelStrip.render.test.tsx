// @vitest-environment jsdom
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"

vi.mock("@agenta/chat/components", () => ({
    RevealCollapse: ({open, children}: {open: boolean; children: React.ReactNode}) =>
        open ? <>{children}</> : null,
}))

vi.mock("@agenta/entity-ui/secretProvider", () => ({
    providerAddView: {id: "project.modelProviders.add"},
}))

vi.mock("@agenta/ui/view-stack", () => ({
    ViewDrawerHost: ({request}: {request: {view: {id: string}; target: {kind: string}}}) => (
        <div role="dialog">{`${request.view.id} ${request.target.kind}`}</div>
    ),
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
    it("opens Add a provider or subscription, not the current provider's key form", async () => {
        host = document.createElement("div")
        document.body.appendChild(host)
        root = createRoot(host)

        await act(async () => {
            root!.render(<ConnectModelStrip gateActive />)
        })

        const button = host.querySelector("button")
        expect(button?.textContent).toContain("Set up model providers")
        expect(host.querySelector('[role="dialog"]')).toBeNull()

        await act(async () => {
            button?.dispatchEvent(new MouseEvent("click", {bubbles: true}))
        })

        expect(host.querySelector('[role="dialog"]')?.textContent).toBe(
            "project.modelProviders.add project",
        )
    })
})
