import type {ReactNode} from "react"

import {TurnMessageHeaderOptions} from "@agenta/playground-ui/adapters"
import {Button} from "@agenta/ui/ui"
import {Database} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

/**
 * The per-message toolbar: view-mode dropdown, re-run, testset slot, attachments, copy, remove
 * and the collapse toggle. Two antd imports on `main` (`Button`/`Tooltip` and `Dropdown`).
 *
 * **The whole toolbar is `invisible` until the surrounding `group/item` is hovered.** A naive
 * story therefore screenshots an empty strip and passes every gate — the exact failure mode the
 * wave-3 notes flag. `Toolbar` below forces visibility with `[&_.invisible]:!visible` on the
 * wrapper so the buttons are actually in the picture; the hidden-by-default behaviour itself is
 * unchanged and is shown by `HiddenUntilHover`.
 */
const meta = {
    title: "@agenta/playground-ui/Turn/HeaderOptions",
    component: TurnMessageHeaderOptions,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component: "Per-message actions rendered in a turn's header.",
            },
        },
    },
} satisfies Meta<typeof TurnMessageHeaderOptions>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const Case = ({label, children}: {label: string; children: ReactNode}) => (
    <div className="flex flex-col gap-1 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="group/item [&_.invisible]:!visible">{children}</div>
    </div>
)

const testsetButton = ({disabled}: {disabled: boolean}) => (
    <Button variant="ghost" size="icon" aria-label="Add to testset" disabled={disabled}>
        <Database size={14} />
    </Button>
)

export const Toolbar: Story = {
    args: {id: "turn-1", text: "Where is my refund?"},
    render: () => (
        <div className="flex max-w-[760px] flex-col">
            <Case label="minimal — view mode, copy, remove (disabled), collapse">
                <TurnMessageHeaderOptions id="t1" text="Where is my refund?" />
            </Case>
            <Case label="full actions — re-run, delete, collapse">
                <TurnMessageHeaderOptions
                    id="t2"
                    text="Where is my refund?"
                    actions={{onRerun: noop, onDelete: noop, onToggleCollapse: noop}}
                />
            </Case>
            <Case label="collapsed — the toggle flips label and icon">
                <TurnMessageHeaderOptions
                    id="t3"
                    text="Where is my refund?"
                    collapsed
                    actions={{onRerun: noop, onDelete: noop, onToggleCollapse: noop}}
                />
            </Case>
            <Case label="disabled — re-run greys out">
                <TurnMessageHeaderOptions
                    id="t4"
                    text="Where is my refund?"
                    disabled
                    actions={{onRerun: noop, onDelete: noop}}
                />
            </Case>
            <Case label="testset slot — enabled once results exist">
                <TurnMessageHeaderOptions
                    id="t5"
                    text="Where is my refund?"
                    results={[{output: "Within 5 days."}]}
                    renderTestsetButton={testsetButton}
                    actions={{onClickTestsetDrawer: noop}}
                />
            </Case>
            <Case label="testset slot — disabled with no results or hashes">
                <TurnMessageHeaderOptions
                    id="t6"
                    text="Where is my refund?"
                    renderTestsetButton={testsetButton}
                    actions={{onClickTestsetDrawer: noop}}
                />
            </Case>
            <Case label="attachments — both slots available">
                <TurnMessageHeaderOptions
                    id="t7"
                    text="Where is my refund?"
                    allowFileUpload
                    uploadCount={1}
                    documentCount={0}
                    actions={{onAddUploadSlot: noop, onAddDocumentSlot: noop}}
                />
            </Case>
            <Case label="attachments — image cap reached at 5, trigger disabled">
                <TurnMessageHeaderOptions
                    id="t8"
                    text="Where is my refund?"
                    allowFileUpload
                    uploadCount={5}
                    documentCount={5}
                    actions={{onAddUploadSlot: noop, onAddDocumentSlot: noop}}
                />
            </Case>
            <Case label="repetitions — expand-results button, enabled by resultHashes">
                <TurnMessageHeaderOptions
                    id="t9"
                    text="Where is my refund?"
                    resultHashes={["h1", "h2"]}
                    onViewAllRepeats={noop}
                />
            </Case>
        </div>
    ),
}

/** No forced visibility — this is what the toolbar looks like before the turn is hovered. */
export const HiddenUntilHover: Story = {
    args: {id: "turn-1", text: "Where is my refund?"},
    render: () => (
        <div className="flex max-w-[760px] flex-col gap-2">
            <div className="text-xs text-colorTextSecondary">
                The toolbar below is present in the DOM but `invisible` — it appears on hover of its
                parent turn. An empty strip here is the correct rendering.
            </div>
            <div className="group/item h-8 rounded border border-dashed border-colorBorderSecondary p-1">
                <TurnMessageHeaderOptions
                    id="t-hidden"
                    text="Where is my refund?"
                    actions={{onRerun: noop, onDelete: noop, onToggleCollapse: noop}}
                />
            </div>
        </div>
    ),
}
