/**
 * "List agents" and "Agent config": one toggle per capability, per-tool controls kept.
 *
 * The toggle adds or removes every tool of its capability, in the Agenta tools section (saved
 * with the agent) and in the Build kit (saved in this browser). A per-tool choice made below it
 * survives the other capability's toggle and, in the Build kit, the capability's own off and on.
 */
import {act, useState} from "react"

import type {AgentaToolsMap, BuildKitUiState} from "@agenta/entities/workflow"
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

import {
    AGENT_CAPABILITIES,
    agentaToolsCapabilityOn,
    availableCapabilities,
    buildKitCapabilityOn,
    setAgentaToolsCapability,
    setBuildKitCapability,
} from "../../src/DrillInView/SchemaControls/agentTemplate/agentCapabilities"
import {AgentaToolsSection} from "../../src/DrillInView/SchemaControls/agentTemplate/AgentaToolsSection"
import {BuildKitSection} from "../../src/DrillInView/SchemaControls/agentTemplate/BuildKitSection"
import {describeBuildKitPlatformTool} from "../../src/DrillInView/SchemaControls/agentTemplate/buildKitDescriptors"

const [LIST, CONFIG] = AGENT_CAPABILITIES
const AGENT_OPS = ["list_agents", "read_agent_config", "create_agent", "edit_agent_config"]
const CONFIG_OPS = ["read_agent_config", "create_agent", "edit_agent_config"]
const ACCESS = {
    rename_session: "write",
    create_agent: "write",
    edit_agent_config: "write",
    list_agents: "read",
    read_agent_config: "read",
} as const
const ALL_ON: AgentaToolsMap = {
    rename_session: "allow",
    list_agents: "allow",
    read_agent_config: "allow",
    create_agent: "allow",
    edit_agent_config: "allow",
}

describe("the capabilities", () => {
    it("group the four agent tools as List agents and Agent config", () => {
        expect(AGENT_CAPABILITIES.map((capability) => capability.name)).toEqual([
            "List agents",
            "Agent config",
        ])
        expect(LIST.ops).toEqual(["list_agents"])
        expect(CONFIG.ops).toEqual(CONFIG_OPS)
    })

    it("show only where their tools are listed", () => {
        expect(availableCapabilities(["rename_session"])).toEqual([])
        expect(availableCapabilities(["list_agents"])).toEqual([LIST])
    })
})

describe("the Agenta tools helpers", () => {
    it("turn a capability off by removing its tools and on with Allow", () => {
        const off = setAgentaToolsCapability(ALL_ON, CONFIG, false)
        expect(off).toEqual({rename_session: "allow", list_agents: "allow"})
        expect(agentaToolsCapabilityOn(off, CONFIG)).toBe(false)
        expect(agentaToolsCapabilityOn(off, LIST)).toBe(true)
        expect(setAgentaToolsCapability(off, CONFIG, true)).toEqual(ALL_ON)
    })

    it("keep a tool already on Ask when the capability is turned on", () => {
        const partial: AgentaToolsMap = {edit_agent_config: "ask"}
        expect(setAgentaToolsCapability(partial, CONFIG, true)).toEqual({
            edit_agent_config: "ask",
            read_agent_config: "allow",
            create_agent: "allow",
        })
    })
})

describe("the Build kit helpers", () => {
    const state: BuildKitUiState = {
        enabled: true,
        disabledOps: ["create_schedule"],
        permissionOverrides: {edit_agent_config: "ask"},
    }

    it("deactivate every tool of the capability and keep the per-tool choice", () => {
        const off = setBuildKitCapability(state, CONFIG, false)
        expect(off.disabledOps).toEqual(["create_schedule", ...CONFIG_OPS])
        expect(off.permissionOverrides).toEqual({edit_agent_config: "ask"})
        expect(buildKitCapabilityOn(off, CONFIG)).toBe(false)
        expect(buildKitCapabilityOn(off, LIST)).toBe(true)

        const on = setBuildKitCapability(off, CONFIG, true)
        expect(on.disabledOps).toEqual(["create_schedule"])
        expect(on.permissionOverrides).toEqual({edit_agent_config: "ask"})
    })

    it("read as off while the whole kit is deactivated", () => {
        expect(buildKitCapabilityOn({...state, enabled: false}, LIST)).toBe(false)
    })
})

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
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

const toggle = (name: string) => {
    const label = [...host.querySelectorAll("span")].find((span) => span.textContent === name)
    return host.querySelector<HTMLButtonElement>(`[aria-labelledby="${label!.id}"]`)!
}
const isOn = (name: string) => toggle(name).getAttribute("aria-checked") === "true"
const row = (op: string) =>
    host.querySelector<HTMLSelectElement>(`[aria-label="Permission for ${op}"]`)!
async function click(button: HTMLButtonElement) {
    await act(async () => button.click())
}
async function choose(select: HTMLSelectElement, value: string) {
    await act(async () => {
        select.value = value
        select.dispatchEvent(new Event("change", {bubbles: true}))
    })
}

describe("the Agenta tools section", () => {
    let saved: AgentaToolsMap
    function Harness({initial}: {initial: AgentaToolsMap}) {
        const [tools, setTools] = useState(initial)
        saved = tools
        return (
            <AgentaToolsSection
                tools={tools}
                onChange={setTools}
                access={ACCESS}
                buildKitOps={new Set()}
            />
        )
    }

    it("shows both capabilities on for a new agent's defaults", async () => {
        await act(async () => root.render(<Harness initial={ALL_ON} />))
        expect(isOn("List agents")).toBe(true)
        expect(isOn("Agent config")).toBe(true)
        for (const op of AGENT_OPS) expect(row(op).value).toBe("allow")
    })

    it("removes and adds back all three Agent config tools with one toggle", async () => {
        await act(async () => root.render(<Harness initial={ALL_ON} />))
        await click(toggle("Agent config"))
        expect(saved).toEqual({rename_session: "allow", list_agents: "allow"})
        for (const op of CONFIG_OPS) expect(row(op).value).toBe("deny")
        expect(row("list_agents").value).toBe("allow")
        expect(isOn("Agent config")).toBe(false)

        await click(toggle("Agent config"))
        expect(saved).toEqual(ALL_ON)
    })

    it("lists agents without write power", async () => {
        await act(async () => root.render(<Harness initial={ALL_ON} />))
        await click(toggle("Agent config"))
        expect(Object.keys(saved).filter((op) => AGENT_OPS.includes(op))).toEqual(["list_agents"])
    })

    it("keeps a per-tool Ask when the other capability is toggled", async () => {
        await act(async () => root.render(<Harness initial={ALL_ON} />))
        await choose(row("edit_agent_config"), "ask")
        await click(toggle("List agents"))
        await click(toggle("List agents"))
        expect(saved.edit_agent_config).toBe("ask")
        expect(saved.read_agent_config).toBe("allow")
        expect(saved.list_agents).toBe("allow")
    })
})

describe("the Build kit section", () => {
    let saved: BuildKitUiState
    const tools = ["create_schedule", ...AGENT_OPS].map((op) => ({
        key: op,
        op,
        readOnly: op === "list_agents" || op === "read_agent_config",
        descriptor: describeBuildKitPlatformTool(op),
    }))
    function Harness({initial}: {initial: BuildKitUiState}) {
        const [state, setState] = useState(initial)
        saved = state
        return <BuildKitSection state={state} onChange={setState} tools={tools} />
    }

    it("is on with every agent tool on Allow by default", async () => {
        await act(async () => root.render(<Harness initial={{enabled: true, disabledOps: []}} />))
        expect(isOn("List agents")).toBe(true)
        expect(isOn("Agent config")).toBe(true)
        for (const op of AGENT_OPS) expect(row(op).value).toBe("allow")
        expect(host.textContent).toContain("Save changes to another agent")
    })

    it("deactivates the three tools and restores each one's choice", async () => {
        await act(async () => root.render(<Harness initial={{enabled: true, disabledOps: []}} />))
        await choose(row("edit_agent_config"), "ask")
        await click(toggle("Agent config"))
        expect(saved.disabledOps).toEqual(CONFIG_OPS)
        for (const op of CONFIG_OPS) expect(row(op).value).toBe("deny")
        expect(row("list_agents").value).toBe("allow")
        expect(row("create_schedule").value).toBe("allow")

        await click(toggle("Agent config"))
        expect(saved.disabledOps).toEqual([])
        expect(row("edit_agent_config").value).toBe("ask")
        expect(row("read_agent_config").value).toBe("allow")
    })
})
