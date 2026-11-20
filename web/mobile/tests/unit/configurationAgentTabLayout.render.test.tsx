// @vitest-environment jsdom
/**
 * The Agent tab of the Configuration page asks for the page layout of the sections (one card per
 * section, A04) on a desktop, and leaves the phone rows (M07) on a phone.
 */
import {act, useContext} from "react"

import {SectionListLayoutContext} from "@agenta/entity-ui/drill-in"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const phone = vi.hoisted(() => ({value: false}))
vi.mock("@agenta/ui/phone", () => ({useIsPhone: () => phone.value}))
vi.mock("@agenta/chat/components", () => ({ModelSetupBanner: () => null}))
vi.mock("@/features/chat/useOpenModelSetup", () => ({useOpenModelSetup: () => () => undefined}))
vi.mock("@agenta/playground-ui/agent-build", () => ({
    AgentBuildPanel: () => {
        const layout = useContext(SectionListLayoutContext)
        return <span data-testid="layout">{layout ?? "none"}</span>
    },
}))

const {ConfigurationAgentTab} = await import("@/features/agent-pages/ConfigurationAgentTab")

let host: HTMLDivElement
let root: Root
beforeEach(() => {
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

const layout = () => host.querySelector('[data-testid="layout"]')?.textContent

describe("ConfigurationAgentTab", () => {
    it("lays the sections out as page cards on a desktop", () => {
        phone.value = false
        act(() => root.render(<ConfigurationAgentTab revisionId="rev-1" readOnly={false} />))
        expect(layout()).toBe("page")
    })

    it("keeps the phone rows on a phone", () => {
        phone.value = true
        act(() => root.render(<ConfigurationAgentTab revisionId="rev-1" readOnly={false} />))
        expect(layout()).toBe("none")
    })
})
