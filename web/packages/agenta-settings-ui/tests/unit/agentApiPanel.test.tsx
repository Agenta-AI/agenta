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
vi.mock("@agenta/ui/ui", () => ({
    Button: ({children, onClick}: React.ComponentProps<"button">) => (
        <button onClick={onClick}>{children}</button>
    ),
    Input: (props: React.ComponentProps<"input">) => <input {...props} />,
    LoadingButton: ({children, onClick}: React.ComponentProps<"button">) => (
        <button onClick={onClick}>{children}</button>
    ),
    Segmented: ({
        options,
        onChange,
    }: {
        options: {value: string; label: string}[]
        onChange: (value: string) => void
    }) => (
        <div>
            {options.map((option) => (
                <button key={option.value} role="tab" onClick={() => onChange(option.value)}>
                    {option.label}
                </button>
            ))}
        </div>
    ),
    Switch: ({
        checked,
        onCheckedChange,
    }: {
        checked: boolean
        onCheckedChange: (value: boolean) => void
    }) => <button role="switch" aria-checked={checked} onClick={() => onCheckedChange(!checked)} />,
}))

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
const snippet = () =>
    container.querySelector('[data-testid="agent-api-snippet"]')?.textContent ?? ""
const button = (text: string) =>
    [...container.querySelectorAll("button")].find((el) => el.textContent === text) as HTMLElement

it("shows the endpoint and streams by default, against the agent's workflow", async () => {
    await render()
    expect(container.querySelector('[data-testid="agent-api-endpoint"]')?.textContent).toBe(
        "https://h/services/agent/v0/invoke?project_id=proj-1",
    )
    expect(snippet()).toContain("stream=True")
    expect(snippet()).toContain('"Accept": "text/event-stream"')
    expect(snippet()).toContain('"workflow": {\n            "id": "agent-1"')
    const docs = container.querySelector("a")
    expect(docs?.textContent).toBe("Read the docs")
    expect(docs?.getAttribute("href")).toBe(
        "https://agenta.ai/docs/reference/agents/invoke-an-agent",
    )
})

it("switches to the JSON response and to another language", async () => {
    await render()
    await act(async () => (container.querySelector('[role="switch"]') as HTMLElement).click())
    expect(snippet()).toContain('"Accept": "application/json"')
    expect(snippet()).not.toContain("text/event-stream")

    await act(async () => button("cURL").click())
    expect(snippet()).toMatch(/^curl -X POST/)
    await act(async () => (container.querySelector('[role="switch"]') as HTMLElement).click())
    expect(snippet()).toMatch(/^curl -N -X POST/)
})

it("fills a created API key into the snippet", async () => {
    await render()
    expect(snippet()).toContain("ApiKey YOUR_API_KEY")
    await act(async () => button("Create API key").click())
    expect(createApiKey).toHaveBeenCalledWith("ws-1", "proj-1")
    expect(snippet()).toContain("ApiKey NEW_KEY")
})
