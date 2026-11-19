import {useEffect, useState} from "react"

import {
    defineView,
    UnsavedChangesDialog,
    useViewForm,
    useViewStack,
    useViewTitle,
    ViewFormActions,
    ViewStackHost,
    type ViewChromeProps,
    type ViewProps,
} from "@agenta/ui/view-stack"
import type {Meta, StoryObj} from "@storybook/nextjs"

// The view stack of D2 in a bare container: a breadcrumb, the top view and its action row. The
// panel, page and phone chromes of later milestones draw the same props their own way.
const DemoChrome = ({crumbs, children, ...actions}: ViewChromeProps) => (
    <div className="flex h-[520px] w-[440px] flex-col border border-solid border-border bg-colorBgContainer">
        <nav className="flex items-center gap-1 border-0 border-b border-solid border-border px-4 py-3 text-sm">
            {crumbs.map((crumb, i) => (
                <span key={i} className="flex items-center gap-1">
                    {i > 0 ? <span className="text-colorTextTertiary">›</span> : null}
                    {crumb.onSelect ? (
                        <button className="text-colorTextSecondary" onClick={crumb.onSelect}>
                            {crumb.title}
                        </button>
                    ) : (
                        <span className="font-medium">{crumb.title}</span>
                    )}
                </span>
            ))}
        </nav>
        <div className="flex min-h-0 flex-1 flex-col px-4 py-3">{children}</div>
        <div className="border-0 border-t border-solid border-border px-4 py-3">
            <ViewFormActions {...actions} />
        </div>
    </div>
)

const InstructionsBody = ({params}: ViewProps<{file: string}>) => {
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
const instructionsView = defineView<{file: string}>({
    id: "story.instructions",
    apply: "on_save",
    Component: InstructionsBody,
})

const Root = () => {
    const stack = useViewStack()
    useEffect(() => {
        void stack.open(
            instructionsView,
            {file: "AGENTS.md"},
            {kind: "agent_draft", revisionId: "rev"},
        )
        // Open once on mount, like a row click.
    }, [])
    return <div className="text-sm">Agent tab</div>
}

const ViewOpen = () => (
    <ViewStackHost chrome={DemoChrome} rootTitle="Agent">
        <Root />
    </ViewStackHost>
)

const meta = {
    title: "BuilderLayout/foundation-a/View stack",
    component: ViewOpen,
    parameters: {layout: "padded"},
} satisfies Meta<typeof ViewOpen>

export default meta
type Story = StoryObj<typeof meta>

/** A view at depth 1 with its breadcrumb and Cancel and Save. */
export const View: Story = {globals: {theme: "light"}}

/** F06 f1: the generic unsaved-changes dialog, with the description of an agent view. */
export const UnsavedDialog: Story = {
    globals: {theme: "light"},
    render: () => (
        <UnsavedChangesDialog
            open
            description="Save your changes to this agent draft, or discard them?"
            canSave
            onAnswer={() => undefined}
        />
    ),
}

export const UnsavedDialogDark: Story = {...UnsavedDialog, globals: {theme: "dark"}}
