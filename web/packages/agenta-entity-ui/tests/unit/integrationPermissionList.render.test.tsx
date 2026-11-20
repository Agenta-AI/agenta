/** The permission list (F02 f6): the Custom count, 25 rows then "Show N more", a red Deny. */
import {act, createElement} from "react"

import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {PermissionDrawerBody} from "../../src/DrillInView/SchemaControls/agentTemplate/IntegrationPermissionList"
import type {GatewayConnectionPermissions} from "../../src/DrillInView/SchemaControls/toolUtils"

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    Element.prototype.scrollIntoView = vi.fn()
    localStorage.clear()
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
})

const writeTools = (count: number) =>
    Array.from({length: count}, (_, i) => ({
        key: `write_${i}`,
        name: `Write ${i}`,
        readOnly: false,
    }))

const render = async (permissions: GatewayConnectionPermissions, toolCount = 3) => {
    await act(async () => {
        root.render(
            createElement(PermissionDrawerBody, {
                catalog: {status: "ready", complete: true, tools: writeTools(toolCount)},
                catalogKey: "zendesk",
                emptyLabel: "No tools listed.",
                permissions,
                onChangePermissions: () => undefined,
                onChangeToolPermission: () => undefined,
            }),
        )
    })
}

const rows = () => host.querySelectorAll('[aria-label^="Permission for"]').length

describe("integration permission list", () => {
    it("reads one per-tool rule as Custom with its count", async () => {
        await render({default: "allow_reads", tools: {write_1: "allow"}})
        const trigger = host.querySelector('[aria-label="Default permission"]')
        expect(trigger?.textContent).toContain("1 override")
        expect(host.textContent).toContain("Picking a preset resets them.")
    })

    it("lists 25 tools of a group of 40, then the rest after Show 15 more", async () => {
        await render({default: "allow", tools: {}}, 40)
        expect(rows()).toBe(25)
        const more = Array.from(host.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("15 more"),
        )
        expect(more).toBeDefined()
        await act(async () => more!.click())
        expect(rows()).toBe(40)
    })

    it("draws a denied tool with the error colour", async () => {
        await render({default: "allow", tools: {write_0: "deny"}})
        const denied = host.querySelector('[aria-label="Permission for write_0"]')
        expect(denied?.className).toContain("colorErrorBg")
    })
})
