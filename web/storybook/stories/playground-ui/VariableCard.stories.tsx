import type {ReactNode} from "react"

import {getDefaultViewForValue, getViewOptions} from "@agenta/entity-ui/view-types"
import {VariableCard} from "@agenta/playground-ui/playground-inputs-body"
import type {Meta, StoryObj} from "@storybook/nextjs"

/**
 * VariableCard — 894 lines and **nine** distinct antd components, the broadest single antd
 * surface in the package: `Alert`, `Button`, `Input`, `InputNumber`, `Switch`, `Tag`, `Tooltip`,
 * `Typography` and `message`.
 *
 * These are showcases rather than parity rows. Reproducing the pre-migration body verbatim here
 * would mean inlining ~900 lines of antd into the story, and the individual swaps are already
 * pixel-gated by the primitives' own parity stories (`button--antd-vs-agenta`,
 * `input--antd-vs-agenta`, `switch--antd-vs-agenta`, …). What is worth covering at this level is
 * that each value KIND still renders its right widget after the swap.
 *
 * Two migration notes that matter here:
 * - The number branch needs a borderless `InputNumber`. The primitive had no such variant, so
 *   wave 3 added `variant="ghost"` to mirror `Input`'s — rather than leaving the call site on
 *   antd, which the guide's rule 3 forbids.
 * - `Switch` changed `onChange` → `onCheckedChange`. That is a silent break: the old prop still
 *   type-checks as a DOM handler and the gates cannot see it, so the boolean row below exists
 *   mainly to prove the toggle is still wired.
 */
const meta = {
    title: "@agenta/playground-ui/Inputs/VariableCard",
    component: VariableCard,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "One input variable: header (name, type chip, copy, view-mode) plus a per-kind body.",
            },
        },
    },
} satisfies Meta<typeof VariableCard>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

/**
 * `options` / `defaultMode` are required props. Derive them the way the real parent does
 * (`PlaygroundInputsBody` calls the same helpers) so the story cannot drift from production.
 */
const card = (name: string, value: unknown, extra: Record<string, unknown> = {}) => ({
    rowId: "row-1",
    onValueChange: noop,
    editable: true,
    name,
    value,
    options: getViewOptions(value),
    defaultMode: getDefaultViewForValue(value),
    ...extra,
})

const Case = ({label, children}: {label: string; children: ReactNode}) => (
    <div className="flex flex-col gap-1">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="w-[520px]">{children}</div>
    </div>
)

export const ByValueKind: Story = {
    args: card("question", "Where is my refund?"),
    render: () => (
        <div className="flex flex-col gap-5">
            <Case label="string">
                <VariableCard {...card("question", "Where is my refund?")} />
            </Case>
            <Case label="number — borderless InputNumber (the new ghost variant)">
                <VariableCard {...card("top_k", 3)} />
            </Case>
            <Case label="boolean — Switch (onChange → onCheckedChange)">
                <VariableCard {...card("stream", true)} />
            </Case>
            <Case label="object — JSON body">
                <VariableCard {...card("filters", {tier: "pro", region: "eu"})} />
            </Case>
            <Case label="empty / no testcase column yet">
                <VariableCard {...card("notes", undefined)} />
            </Case>
        </div>
    ),
}

export const HeaderStates: Story = {
    args: card("question", "hello"),
    render: () => (
        <div className="flex flex-col gap-5">
            <Case label="draft badge (antd Tag → Badge)">
                <VariableCard {...card("new_var", "", {isDraft: true})} />
            </Case>
            <Case label="help tooltip (antd Tooltip → Radix Tooltip)">
                <VariableCard
                    {...card("inputs", "…", {
                        helpText: "The evaluator envelope's inputs field.",
                    })}
                />
            </Case>
            <Case label="synced from testset">
                <VariableCard
                    {...card("question", "Where is my refund?", {
                        connectedSourceName: "Support triage",
                    })}
                />
            </Case>
            <Case label="read-only">
                <VariableCard {...card("question", "frozen", {editable: false})} />
            </Case>
        </div>
    ),
}
