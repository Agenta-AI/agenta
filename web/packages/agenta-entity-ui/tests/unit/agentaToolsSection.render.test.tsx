import {act, useState} from "react"

import type {AgentaToolsMap} from "@agenta/entities/workflow"
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

import {AgentaToolsSection} from "../../src/DrillInView/SchemaControls/agentTemplate/AgentaToolsSection"

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let saved: AgentaToolsMap
const access = {
    rename_session: "write",
    create_schedule: "write",
    get_current_session: "read",
    list_schedules: "read",
} as const

function Harness({initial}: {initial: AgentaToolsMap}) {
    const [tools, setTools] = useState(initial)
    saved = tools
    return (
        <AgentaToolsSection
            tools={tools}
            onChange={setTools}
            access={access}
            buildKitOps={new Set(["create_schedule"])}
        />
    )
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
const preset = () => host.querySelector<HTMLSelectElement>('[aria-label="Default permission"]')!
const row = (op: string) =>
    host.querySelector<HTMLSelectElement>(`[aria-label="Permission for ${op}"]`)!
async function choose(select: HTMLSelectElement, value: string) {
    await act(async () => {
        select.value = value
        select.dispatchEvent(new Event("change", {bubbles: true}))
    })
}
const defaults: AgentaToolsMap = {get_current_session: "allow", rename_session: "allow"}

describe("Agenta tools section", () => {
    it("shows every tool, the defaults on and the rest deactivated", async () => {
        await act(async () => root.render(<Harness initial={defaults} />))
        expect(host.textContent).toContain("Get the link to this chat")
        expect(host.textContent).toContain("Rename this chat")
        expect(host.textContent).toContain("wherever it runs")
        expect(row("get_current_session").value).toBe("allow")
        expect(row("rename_session").value).toBe("allow")
        expect(row("create_schedule").value).toBe("deny")
        expect(row("list_schedules").value).toBe("deny")
        expect(preset().value).toBe("custom")
    })

    it("marks the tools the build kit also carries", async () => {
        await act(async () => root.render(<Harness initial={defaults} />))
        expect(host.textContent).toContain("In the playground, the Build kit setting applies.")
    })

    it("adds a tool on Allow or Ask and removes it on Deactivate", async () => {
        await act(async () => root.render(<Harness initial={defaults} />))
        await choose(row("create_schedule"), "ask")
        expect(saved).toEqual({...defaults, create_schedule: "ask"})
        await choose(row("rename_session"), "deny")
        expect(saved).toEqual({get_current_session: "allow", create_schedule: "ask"})
        expect(row("rename_session").value).toBe("deny")
    })

    it("applies the presets, and Deactivate leaves an empty map", async () => {
        await act(async () => root.render(<Harness initial={defaults} />))
        await choose(preset(), "ask_writes")
        expect(saved).toEqual({
            rename_session: "ask",
            create_schedule: "ask",
            get_current_session: "allow",
            list_schedules: "allow",
        })
        expect(preset().value).toBe("ask_writes")
        await choose(preset(), "deny_all")
        expect(saved).toEqual({})
        expect(preset().value).toBe("deny_all")
        await choose(preset(), "allow_all")
        expect(Object.values(saved)).toEqual(["allow", "allow", "allow", "allow"])
    })

    it("names every Agenta tool with its own copy", async () => {
        const ops = [
            "get_current_session",
            "rename_session",
            "rename_agent",
            "create_schedule",
            "create_subscription",
            "remove_schedule",
            "remove_subscription",
            "list_schedules",
            "list_subscriptions",
            "list_deliveries",
            "test_subscription",
            "discover_triggers",
            "commit_revision",
            "read_config",
            "check_skill_updates",
            "apply_skill_update",
        ]
        await act(async () =>
            root.render(
                <AgentaToolsSection
                    tools={{}}
                    onChange={() => undefined}
                    access={Object.fromEntries(ops.map((op) => [op, "write" as const]))}
                    buildKitOps={new Set()}
                />,
            ),
        )
        expect(host.textContent).not.toContain("Playground-only")
    })
})
