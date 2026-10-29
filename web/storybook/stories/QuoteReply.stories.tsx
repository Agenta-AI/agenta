import {ComposerQuotes} from "@agenta/chat/components"
import type {Quote} from "@agenta/shared/quotes"
import {QuoteNote, QuoteToolbar} from "@agenta/ui/quote-selection"
import type {Meta, StoryObj} from "@storybook/nextjs"

// Quote-to-reply states a reviewer cannot reach by clicking.
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
    source: {kind: "message", messageId: "m-1"},
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

const longFileQuote = (id: string, startLine: number, text: string): Quote => ({
    id,
    text,
    note: "",
    staged: true,
    stale: false,
    source: {
        kind: "file",
        path: "reports/2026-10-12-automation-builder-full-picture.md",
        displayPath: "agent-files/reports/2026-10-12-automation-builder-full-picture.md",
        fileName: "2026-10-12-automation-builder-full-picture.md",
        startLine,
        endLine: startLine,
    },
})

/** Several quotes from one long-named file, the shape a review of a report produces. */
const longFileQuotes: Quote[] = [
    longFileQuote("q-long-1", 57, "Focus on those who are making money with automations today."),
    longFileQuote("q-long-2", 59, "The builder should start from a template, not a blank canvas."),
    longFileQuote("q-long-3", 65, "Schedules"),
    {...longFileQuote("q-long-4", 71, "Pricing depends on the run count."), stale: true},
    messageQuote,
]

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
            <Stage label="Note box on a message quote" height={260}>
                <QuoteNote
                    quote={messageQuote}
                    anchor={{top: 8, left: 240, bottom: 24}}
                    bounds={{width: 520, height: 260}}
                    onStage={() => {}}
                    onSend={() => {}}
                    onCancel={() => {}}
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

/**
 * Long file names in containers from a phone to a wide desktop. A chip never grows past its row:
 * the excerpt and the file name truncate, and the line range, the stale tag and the remove button
 * always stay visible inside the border.
 */
export const ChipsWithLongFileNames: Story = {
    render: () => (
        <div className="flex flex-col gap-6">
            {[
                {label: "Phone, 320px, touch", width: 320, touch: true},
                {label: "Phone, 390px, touch", width: 390, touch: true},
                {label: "Side panel, 560px", width: 560, touch: false},
                {label: "Desktop, 900px", width: 900, touch: false},
            ].map(({label, width, touch}) => (
                <div key={label} className="flex flex-col gap-2" style={{width}}>
                    <div className="text-xs text-colorTextSecondary">{label}</div>
                    <div className="rounded-lg border border-solid border-colorBorderSecondary">
                        <ComposerQuotes quotes={longFileQuotes} onRemove={() => {}} touch={touch} />
                    </div>
                </div>
            ))}
        </div>
    ),
}
