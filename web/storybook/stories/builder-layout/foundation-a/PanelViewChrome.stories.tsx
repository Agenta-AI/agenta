import {useEffect, useState} from "react"

import {AgentPanelContext, type AgentPanelApi} from "@/features/agent-layout/agentPanelContext"
import {PanelViewChrome} from "@/features/agent-layout/PanelViewChrome"
import {
    defineView,
    useViewForm,
    useViewStack,
    useViewTitle,
    ViewStackHost,
    type ViewProps,
} from "@agenta/ui/view-stack"
import type {Meta, StoryObj} from "@storybook/nextjs"

const noopPanel = (phone: boolean): AgentPanelApi => ({
    content: "configuration",
    toggle: async () => true,
    close: async () => true,
    configTab: "agent",
    setConfigTab: () => undefined,
    wide: false,
    setWide: () => undefined,
    phone,
    available: {files: true, configuration: true, builder: false},
})

const EditorBody = ({params}: ViewProps<{file: string}>) => {
    const [text, setText] = useState("Be terse. Answer in one line.")
    useViewTitle(params.file)
    useViewForm({
        dirty: text !== "Be terse. Answer in one line.",
        valid: true,
        save: async () => true,
        leaveDescription: "Save your changes to this agent draft, or discard them?",
    })
    return (
        <textarea
            className="min-h-0 flex-1 rounded-md border border-solid border-border p-2 text-sm"
            value={text}
            onChange={(e) => setText(e.target.value)}
        />
    )
}
const editorView = defineView<{file: string}>({
    id: "story.agentsMd",
    apply: "on_save",
    wide: true,
    Component: EditorBody,
})

const Root = () => {
    const stack = useViewStack()
    useEffect(() => {
        void stack.open(editorView, {file: "AGENTS.md"}, {kind: "agent_draft", revisionId: "rev"})
        // Open once on mount, like a row click.
    }, [])
    return null
}

/** The right panel's chrome around an open view: breadcrumb, widen, close, Cancel and Save. */
const PanelView = ({phone = false}: {phone?: boolean}) => (
    <AgentPanelContext.Provider value={noopPanel(phone)}>
        <div
            data-testid="agent-panel"
            className="ag-panel-raised flex h-[640px] flex-col border border-solid border-border"
            style={{width: phone ? 390 : 440}}
        >
            <ViewStackHost chrome={PanelViewChrome} rootTitle="Agent">
                <Root />
            </ViewStackHost>
        </div>
    </AgentPanelContext.Provider>
)

const meta = {
    title: "BuilderLayout/foundation-a/Panel view chrome",
    component: PanelView,
    parameters: {layout: "padded"},
} satisfies Meta<typeof PanelView>

export default meta
type Story = StoryObj<typeof meta>

export const Desktop: Story = {globals: {theme: "light"}}
export const DesktopDark: Story = {globals: {theme: "dark"}}
export const Phone: Story = {args: {phone: true}, globals: {theme: "light"}}
