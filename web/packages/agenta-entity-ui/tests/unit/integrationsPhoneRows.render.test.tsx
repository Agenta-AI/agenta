/**
 * On a phone the Integrations section lists each integration as a row with whose account it uses
 * and a chevron, with no bin (M08). Without the phone context the rows stay the desktop cards.
 */
import {act, createElement} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest"

vi.mock("@agenta/entities/gatewayTool", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/gatewayTool")>()),
    useToolIntegrationDetail: (slug: string) => ({
        integration: {name: slug === "zendesk" ? "Zendesk" : "Slack", logo: null},
    }),
}))

import {
    PhoneSectionsContext,
    type PhoneSectionsApi,
} from "../../src/DrillInView/SchemaControls/agentTemplate/phoneSections"
import {ToolManagementList} from "../../src/DrillInView/SchemaControls/agentTemplate/ToolManagementList"
import type {IntegrationRow} from "../../src/DrillInView/SchemaControls/toolUtils"

beforeAll(() => {
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
})

let container: HTMLDivElement
let root: Root
beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
})
afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

const row = (integration: string, accountSource?: "user"): IntegrationRow =>
    ({
        provider: "composio",
        integration,
        entry: {integration, ...(accountSource ? {accountSource} : {connection: "acme"})},
        entryIndices: [0],
        legacyIndices: [],
        legacyConnections: [],
    }) as unknown as IntegrationRow

const rows = [row("zendesk", "user"), row("slack")]

const renderList = (phone: PhoneSectionsApi | null, onOpen = vi.fn(), onRemove = vi.fn()) =>
    act(() =>
        root.render(
            createElement(
                PhoneSectionsContext.Provider,
                {value: phone},
                createElement(ToolManagementList, {
                    tools: [{}, {}],
                    integrationRows: rows,
                    onOpenIntegration: onOpen,
                    onRemoveIntegration: onRemove,
                }),
            ),
        ),
    )

describe("ToolManagementList on a phone", () => {
    it("shows the name and whose account each integration uses, with no bin", () => {
        renderList({shownKey: "tools", show: vi.fn()})
        const buttons = [...container.querySelectorAll("button")]
        expect(buttons.map((b) => b.textContent)).toEqual([
            "ZendeskEach person's own account",
            "SlackOne shared account",
        ])
        expect(container.querySelector("[aria-label=Remove]")).toBeNull()
    })

    it("opens the integration on a tap", () => {
        const onOpen = vi.fn()
        renderList({shownKey: "tools", show: vi.fn()}, onOpen)
        act(() => container.querySelectorAll("button")[0].click())
        expect(onOpen).toHaveBeenCalledWith(rows[0])
    })

    it("keeps the desktop rows with their bin outside a phone", () => {
        renderList(null)
        expect(container.textContent).not.toContain("Each person's own account")
        expect(container.querySelectorAll("[aria-label=Remove]")).toHaveLength(2)
    })
})
