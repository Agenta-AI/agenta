import {useState} from "react"

import {QueuedMessagesDock} from "@agenta/chat/components"
import type {QueuedMessage} from "@agenta/chat/hooks"
import type {Meta, StoryObj} from "@storybook/react"
import type {FileUIPart} from "ai"

const meta: Meta<typeof QueuedMessagesDock> = {
    title: "Chat/QueuedMessagesDock",
    component: QueuedMessagesDock,
    parameters: {layout: "padded"},
}
export default meta

type Story = StoryObj<typeof QueuedMessagesDock>

/** A 1x1 PNG, so the attachment stories render a real decoded thumbnail with no network. */
const PIXEL =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg=="

const msg = (id: string, text: string, fileParts?: FileUIPart[]): QueuedMessage => ({
    id,
    text,
    fileParts,
})

const THREE = [
    msg("1", "I wanted to explore few possibilities"),
    msg("2", "check dev.to for overlap first"),
    msg("3", "add a section on cognitive debt, then update the SEO keywords"),
]

const noop = () => {}

/** A narrow column, so the row truncation and the scroll cap are both visible. */
const Frame = ({children}: {children: React.ReactNode}) => (
    <div className="w-full max-w-[600px]">{children}</div>
)

/** Removing and clearing are real here, so the scroll cap and the empty tail can be exercised. */
const Live = ({
    initial,
    editable = true,
    ...rest
}: {
    initial: QueuedMessage[]
    editable?: boolean
} & Partial<React.ComponentProps<typeof QueuedMessagesDock>>) => {
    const [queued, setQueued] = useState(initial)
    const [editingId, setEditingId] = useState<string | null>(null)
    return (
        <Frame>
            <QueuedMessagesDock
                queued={queued}
                onRemove={(id) => setQueued((q) => q.filter((m) => m.id !== id))}
                onEdit={editable ? (m) => setEditingId(m.id) : undefined}
                onCancelEdit={() => setEditingId(null)}
                editingId={editingId}
                {...rest}
            />
        </Frame>
    )
}

export const Default: Story = {
    render: () => <Live initial={THREE} />,
}

/** One message: the header reads singular. */
export const Single: Story = {
    render: () => <Live initial={[THREE[0]]} />,
}

/** The run is parked on the user, so the queue is held rather than merely waiting its turn. */
export const Held: Story = {
    render: () => <Live initial={THREE} held />,
}

/** Past five rows the body scrolls and the card stops growing; the header stays put. */
export const Overflowing: Story = {
    render: () => (
        <Live
            initial={Array.from({length: 12}, (_, i) =>
                msg(
                    String(i),
                    `Queued message ${i + 1} — long enough to need the ellipsis when the column narrows`,
                ),
            )}
        />
    ),
}

/** The composer is holding this row's text; the row is marked and offers the way out. */
export const Editing: Story = {
    render: () => (
        <Frame>
            <QueuedMessagesDock
                queued={THREE}
                editingId="2"
                onRemove={noop}
                onEdit={noop}
                onCancelEdit={noop}
            />
        </Frame>
    ),
}

/**
 * Files lead the row. One shows its own tile; several collapse to a single counted block, so the
 * row never grows with the file count. The last row has none, for the alignment contrast.
 */
export const WithAttachments: Story = {
    render: () => (
        <Live
            initial={[
                msg("1", "use this crop for the hero", [
                    {type: "file", url: PIXEL, mediaType: "image/png", filename: "hero.png"},
                ]),
                msg("2", "the whole set from the shoot", [
                    {type: "file", url: "", mediaType: "audio/wav", filename: "take-3.wav"},
                    {type: "file", url: "", mediaType: "text/csv", filename: "metrics.csv"},
                    {type: "file", url: PIXEL, mediaType: "image/png", filename: "b-roll.png"},
                ]),
                msg("3", "", [
                    {type: "file", url: "", mediaType: "audio/wav", filename: "voice-note.wav"},
                    {type: "file", url: "", mediaType: "application/pdf", filename: "brief.pdf"},
                ]),
                msg("4", "and swap the closing paragraph"),
            ]}
        />
    ),
}

/** Touch: identical chrome, invisibly extended tap areas. */
export const Touch: Story = {
    render: () => <Live initial={THREE} touch />,
}
