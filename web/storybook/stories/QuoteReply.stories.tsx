import {ComposerQuotes} from "@agenta/chat/components"
import type {Quote} from "@agenta/shared/quotes"
import {QuoteNote, QuoteToolbar} from "@agenta/ui/quote-selection"
import type {Meta, StoryObj} from "@storybook/nextjs"

/**
 * Quote-to-reply — select part of a settled agent reply or a file preview, reply to just that
 * span, and send the excerpt along with the message.
 *
 * These are the states a reviewer cannot reach by clicking: the pill flipped below its selection,
 * the note box, and a chip row that has gone stale.
 */
const meta = {
    title: "@agenta/ui/Chat/QuoteReply",
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The floating Copy · Reply pill, the inline note box anchored under a highlighted span, and the composer chips the staged quotes become. Live positioning comes from the selection; these stories pin the anchors so every state is reachable.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const messageQuote: Quote = {
    id: "q-message",
    text: "A schedule runs one pinned variant and revision, so the estimate never drifts between runs.",
    note: "This contradicts the section above.",
    staged: true,
    stale: false,
    source: {kind: "message", messageId: "m-1", turnLabel: "Agent reply"},
}

const fileQuote: Quote = {
    id: "q-file",
    text: "A schedule runs one pinned variant and revision.",
    note: "",
    staged: true,
    stale: false,
    source: {
        kind: "file",
        path: "docs/07-schedule-an-automation.mdx",
        displayPath: "agent-files/docs/07-schedule-an-automation.mdx",
        fileName: "07-schedule-an-automation.mdx",
        startLine: 34,
        endLine: 36,
    },
}

const staleQuote: Quote = {...fileQuote, id: "q-stale", stale: true}

const Stage = ({
    label,
    height = 160,
    children,
}: {
    label: string
    height?: number
    children: React.ReactNode
}) => (
    <div className="mb-6 flex flex-col gap-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div
            className="relative rounded-lg border border-solid border-colorBorderSecondary bg-colorBgContainer p-4"
            style={{height}}
        >
            {children}
        </div>
    </div>
)

/** The pill above its selection, and flipped below when the selection sits at the pane's top. */
export const Toolbar: Story = {
    render: () => (
        <>
            <Stage label="Anchored above the selection">
                <QuoteToolbar
                    anchor={{top: 90, left: 200, bottom: 110}}
                    bounds={{width: 520, height: 160}}
                    onCopy={() => {}}
                    onReply={() => {}}
                />
            </Stage>
            <Stage label="No room above — flipped below">
                <QuoteToolbar
                    anchor={{top: 4, left: 200, bottom: 24}}
                    bounds={{width: 520, height: 160}}
                    onCopy={() => {}}
                    onReply={() => {}}
                />
            </Stage>
            <Stage label="Touch targets">
                <QuoteToolbar
                    anchor={{top: 90, left: 200, bottom: 110}}
                    bounds={{width: 520, height: 160}}
                    onCopy={() => {}}
                    onReply={() => {}}
                    touch
                />
            </Stage>
        </>
    ),
}

/** The inline note box, on a message quote and a file quote. */
export const Note: Story = {
    render: () => (
        <>
            <Stage label="Note box on a file quote" height={260}>
                <QuoteNote
                    quote={fileQuote}
                    anchor={{top: 8, left: 240, bottom: 24}}
                    bounds={{width: 520, height: 260}}
                    onStage={() => {}}
                    onSend={() => {}}
                    onCancel={() => {}}
                />
            </Stage>
            <Stage label="Note box on a message quote (touch)" height={260}>
                <QuoteNote
                    quote={messageQuote}
                    anchor={{top: 8, left: 240, bottom: 24}}
                    bounds={{width: 520, height: 260}}
                    onStage={() => {}}
                    onSend={() => {}}
                    onCancel={() => {}}
                    touch
                />
            </Stage>
        </>
    ),
}

/** The chips the staged quotes become, above the composer input. */
export const Chips: Story = {
    render: () => (
        <div className="flex flex-col gap-6">
            <div className="rounded-lg border border-solid border-colorBorderSecondary">
                <ComposerQuotes quotes={[messageQuote]} onRemove={() => {}} />
            </div>
            <div className="rounded-lg border border-solid border-colorBorderSecondary">
                <ComposerQuotes
                    quotes={[messageQuote, fileQuote, staleQuote]}
                    onRemove={() => {}}
                />
            </div>
            <div className="rounded-lg border border-solid border-colorBorderSecondary">
                <ComposerQuotes quotes={[fileQuote, staleQuote]} onRemove={() => {}} touch />
            </div>
        </div>
    ),
}
