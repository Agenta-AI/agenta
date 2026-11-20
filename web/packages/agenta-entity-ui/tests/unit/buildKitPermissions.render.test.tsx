import {act, useState} from "react"

import type {BuildKitUiState} from "@agenta/entities/workflow"
import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

vi.mock("../../src/DrillInView/SchemaControls/agentTemplate/PermissionPolicySelect", () => ({
    PermissionPolicySelect: (props: {
        value: string
        onChange: (value: string) => void
        disabled?: boolean
        options: {value: string; title: string; disabled?: boolean}[]
        "aria-label"?: string
    }) => (
        <select
            aria-label={props["aria-label"]}
            value={props.value}
            disabled={props.disabled}
            onChange={(event) => props.onChange(event.target.value)}
        >
            {props.options.map((option) => (
                <option key={option.value} value={option.value} disabled={option.disabled}>
                    {option.title}
                </option>
            ))}
        </select>
    ),
}))

import {BuildKitSection} from "../../src/DrillInView/SchemaControls/agentTemplate/BuildKitSection"
import {
    describeBuildKitEmbed,
    describeBuildKitPlatformTool,
} from "../../src/DrillInView/SchemaControls/agentTemplate/buildKitDescriptors"

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let saved: BuildKitUiState
const tools = [
    {
        key: "create_schedule",
        op: "create_schedule",
        readOnly: false,
        descriptor: describeBuildKitPlatformTool("create_schedule"),
    },
    {
        key: "list_schedules",
        op: "list_schedules",
        readOnly: true,
        descriptor: describeBuildKitPlatformTool("list_schedules"),
    },
    {
        key: "__ag__request_input",
        descriptor: describeBuildKitEmbed("__ag__request_input", undefined),
    },
]
function Harness({initial}: {initial: BuildKitUiState}) {
    const [state, setState] = useState(initial)
    saved = state
    return <BuildKitSection state={state} onChange={setState} tools={tools} />
}
beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})
afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
})
const select = () => host.querySelector<HTMLSelectElement>('[aria-label="Default permission"]')!
async function pick(value: string) {
    await act(async () => {
        select().value = value
        select().dispatchEvent(new Event("change", {bubbles: true}))
    })
}

describe("build kit permission panel", () => {
    it("offers the four presets and Custom read-back; active presets reset overrides", async () => {
        await act(async () =>
            root.render(
                <Harness
                    initial={{
                        enabled: true,
                        disabledOps: ["create_schedule"],
                        permissionOverrides: {list_schedules: "ask"},
                    }}
                />,
            ),
        )
        expect(select().selectedOptions[0].textContent).toBe("Custom · 2 overrides")
        expect([...select().options].map((option) => option.textContent)).toEqual([
            "Allow all",
            "Ask all",
            "Allow reads",
            "Deactivate",
            "Custom · 2 overrides",
        ])
        await pick("ask_writes")
        expect(saved).toEqual({
            enabled: true,
            disabledOps: [],
            permissionOverrides: {},
            permissionDefault: "allow_reads",
        })
        await pick("deny_all")
        expect(saved.enabled).toBe(false)
        expect(select().disabled).toBe(false)
        expect(host.textContent).toContain("The build kit is off")
        await pick("allow_all")
        expect(saved).toEqual({
            enabled: true,
            disabledOps: [],
            permissionOverrides: {},
            permissionDefault: "allow",
        })
    })
    it("sets per-tool Ask or Deactivate and disables rows while the kit is off", async () => {
        await act(async () => root.render(<Harness initial={{enabled: true, disabledOps: []}} />))
        const row = host.querySelector<HTMLSelectElement>(
            '[aria-label="Permission for create_schedule"]',
        )!
        expect([...row.options].map((option) => option.textContent)).toEqual([
            "Allow",
            "Ask",
            "Deactivate",
        ])
        await act(async () => {
            row.value = "ask"
            row.dispatchEvent(new Event("change", {bubbles: true}))
        })
        expect(saved.permissionOverrides).toEqual({create_schedule: "ask"})
        await act(async () => {
            row.value = "deny"
            row.dispatchEvent(new Event("change", {bubbles: true}))
        })
        expect(saved.disabledOps).toEqual(["create_schedule"])
        expect(saved.permissionOverrides).toEqual({})
        await pick("deny_all")
        expect(row.disabled).toBe(true)
        expect(row.value).toBe("deny")
        expect(host.textContent).not.toContain("runs automatically")
        await pick("always_ask")
        expect(row.disabled).toBe(false)
        expect(row.value).toBe("ask")
    })
    it("defaults to Allow all and keeps human input outside the policy list", async () => {
        await act(async () => root.render(<Harness initial={{enabled: true, disabledOps: []}} />))
        expect(select().value).toBe("allow_all")
        expect(host.textContent).toContain("Read-only")
        expect(host.textContent).toContain("Write")
        expect(host.textContent).toContain("Included while the build kit is active")
        expect(host.querySelector('[aria-label="Request input"]')).toBeNull()
    })
})
