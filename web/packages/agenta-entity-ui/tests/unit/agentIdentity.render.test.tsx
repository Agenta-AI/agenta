/**
 * The composed identity: icon chip and name are ONE control, and both halves are editable.
 *
 * The two hosts used to hand-assemble these (the mobile top bar had rename, the overview page did
 * not), so the assertions are about what the component guarantees at every call site: a picker
 * trigger, a rename affordance, and a commit that reaches the rename write.
 */
import {renderToStaticMarkup} from "react-dom/server"
import {beforeEach, describe, expect, it, vi} from "vitest"

const renames = vi.hoisted(() => ({calls: [] as [string, string][]}))

vi.mock("../../src/agent/useAgentActions", () => ({
    useRenameAgent: () => async (id: string, name: string) => {
        renames.calls.push([id, name])
        return true
    },
}))

const {AgentIdentity} = await import("../../src/agent/AgentIdentity")
const {createRoot} = await import("react-dom/client")
const {act} = await import("react")

beforeEach(() => {
    renames.calls = []
})

describe("AgentIdentity", () => {
    it("renders both halves — the icon picker's trigger and the name with its rename pencil", () => {
        const html = renderToStaticMarkup(<AgentIdentity workflowId="wf-1" name="Support triage" />)
        expect(html).toContain('aria-label="Change agent icon"')
        expect(html).toContain("Support triage")
        expect(html).toContain('aria-label="Rename agent"')
    })

    it("puts the page-title rung on a heading and the bar rung on a span", () => {
        expect(
            renderToStaticMarkup(<AgentIdentity workflowId="wf-1" name="Support" size="title" />),
        ).toContain("<h1")
        expect(
            renderToStaticMarkup(<AgentIdentity workflowId="wf-1" name="Support" />),
        ).not.toContain("<h1")
    })

    it("drops both edits when the host asks for a read-only identity", () => {
        const html = renderToStaticMarkup(
            <AgentIdentity workflowId="wf-1" name="Support" editable={false} />,
        )
        expect(html).toContain("Support")
        expect(html).not.toContain('aria-label="Change agent icon"')
        expect(html).not.toContain('aria-label="Rename agent"')
    })

    // The overview screen shows a skeleton until the roster lands; the icon stays pickable.
    it("swaps the name for the host's placeholder without losing the icon trigger", () => {
        const html = renderToStaticMarkup(
            <AgentIdentity
                workflowId="wf-1"
                name="Agent"
                namePlaceholder={<span>loading-name</span>}
            />,
        )
        expect(html).toContain("loading-name")
        expect(html).not.toContain('aria-label="Rename agent"')
        expect(html).toContain('aria-label="Change agent icon"')
    })

    it("commits a rename typed into the inline field", async () => {
        const host = document.createElement("div")
        document.body.appendChild(host)
        const root = createRoot(host)
        await act(async () => {
            root.render(<AgentIdentity workflowId="wf-1" name="Support triage" />)
        })

        const pencil = host.querySelector<HTMLButtonElement>('button[aria-label="Rename agent"]')
        await act(async () => {
            pencil?.click()
        })

        const input = host.querySelector<HTMLInputElement>('input[aria-label="Agent name"]')
        expect(input).not.toBeNull()
        const setValue = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            "value",
        )?.set
        await act(async () => {
            setValue?.call(input, "Billing triage")
            input?.dispatchEvent(new Event("input", {bubbles: true}))
        })
        await act(async () => {
            input?.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}))
        })

        expect(renames.calls).toEqual([["wf-1", "Billing triage"]])
        root.unmount()
        host.remove()
    })
})
