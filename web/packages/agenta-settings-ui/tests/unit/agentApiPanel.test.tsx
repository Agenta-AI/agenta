// @vitest-environment jsdom
import React, {act} from "react"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, expect, it, vi} from "vitest"

const {createApiKey} = vi.hoisted(() => ({createApiKey: vi.fn(async () => "NEW_KEY")}))
vi.mock("@agenta/settings", () => ({createApiKey}))
vi.mock("@agenta/ui/app-message", () => ({message: {success: vi.fn(), error: vi.fn()}}))
vi.mock("@agenta/ui/components/presentational", () => ({
    CopyButton: ({text}: {text: string}) => <button data-copy={text}>copy</button>,
}))
vi.mock("@agenta/ui/ui", () => {
    const Ctx = React.createContext<{value: string; set: (v: string) => void}>({
        value: "",
        set: () => undefined,
    })
    return {
        Input: (props: React.ComponentProps<"input">) => <input {...props} />,
        LoadingButton: ({children, onClick}: React.ComponentProps<"button">) => (
            <button onClick={onClick}>{children}</button>
        ),
        Tabs: ({
            value,
            onValueChange,
            children,
        }: {
            value: string
            onValueChange: (v: string) => void
            children: React.ReactNode
        }) => <Ctx.Provider value={{value, set: onValueChange}}>{children}</Ctx.Provider>,
        TabsList: ({children}: {children: React.ReactNode}) => <div>{children}</div>,
        TabsTrigger: ({value, children}: {value: string; children: React.ReactNode}) => {
            const ctx = React.useContext(Ctx)
            return (
                <button role="tab" onClick={() => ctx.set(value)}>
                    {children}
                </button>
            )
        },
        TabsContent: ({children}: {children: React.ReactNode}) => <div>{children}</div>,
    }
})

import {AgentApiPanel} from "../../src/publish/AgentApiPanel"

let root: Root
let container: HTMLDivElement
beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
})
afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
})

const render = async () =>
    act(async () =>
        root.render(
            <AgentApiPanel
                agentId="agent-1"
                projectId="proj-1"
                workspaceId="ws-1"
                host="https://h"
            />,
        ),
    )
const snippet = (key: string) =>
    container.querySelector(`[data-testid="agent-api-snippet-${key}"] pre`)?.textContent ?? ""

it("shows the streaming snippet first, then the JSON one, targeting the agent's workflow", async () => {
    await render()
    const keys = [...container.querySelectorAll("[data-testid^=agent-api-snippet-]")].map((el) =>
        el.getAttribute("data-testid"),
    )
    expect(keys).toEqual(["agent-api-snippet-stream", "agent-api-snippet-json"])
    expect(snippet("stream")).toContain("stream=True")
    expect(snippet("stream")).toContain('"workflow": {\n            "id": "agent-1"')
    expect(snippet("json")).toContain('"Accept": "application/json"')
    expect(snippet("json")).toContain("https://h/services/agent/v0/invoke?project_id=proj-1")
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
        "https://agenta.ai/docs/reference/agents/invoke-an-agent",
    )
})

it("switches language and fills a generated key into the snippets", async () => {
    await render()
    const curlTab = [...container.querySelectorAll('[role="tab"]')].find(
        (tab) => tab.textContent === "cURL",
    ) as HTMLElement
    await act(async () => curlTab.click())
    expect(snippet("stream")).toMatch(/^curl -N -X POST/)
    expect(snippet("stream")).toContain("ApiKey YOUR_API_KEY")

    const generate = [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "Generate API Key",
    ) as HTMLElement
    await act(async () => generate.click())
    expect(createApiKey).toHaveBeenCalledWith("ws-1", "proj-1")
    expect(snippet("stream")).toContain("ApiKey NEW_KEY")
    expect(snippet("json")).toContain("ApiKey NEW_KEY")
})
