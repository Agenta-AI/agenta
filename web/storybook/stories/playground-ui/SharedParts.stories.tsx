import type {RunnablePort} from "@agenta/entities/runnable"
import {EntityStatusTag, EvaluatorFieldGrid, NodeResultCard} from "@agenta/playground-ui/shared"
import {Button} from "@agenta/ui/ui"
import {ArrowClockwise} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

/**
 * The three `./shared` components that render a whole block rather than a single chip —
 * `SharedLeaves.stories.tsx` covers the chips (`NodeNameTag` and the badge family).
 *
 * All three are prop-only: no atoms, no context, no fixtures. `CollapseToggleButton` is
 * deliberately absent — the playground-ui file is a pure re-export of the `@agenta/ui`
 * component, which has its own parity story (`stories/CollapseToggleButton.stories.tsx`).
 * A second story here would render identical code.
 */
const meta = {
    title: "@agenta/playground-ui/Shared/Parts",
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Entity status tag, the evaluator field grid, and the node result card shell.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const Section = ({label, children}: {label: string; children: React.ReactNode}) => (
    <section className="flex flex-col gap-2 border-b border-colorBorderSecondary py-4">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        {children}
    </section>
)

const port = (key: string, type: string): RunnablePort => ({key, name: key, type})

const OUTPUT_PORTS: RunnablePort[] = [
    port("score", "number"),
    port("success", "boolean"),
    port("reasoning", "string"),
]

export const StatusTag: Story = {
    render: () => (
        <div className="flex max-w-[640px] flex-col">
            <Section label="pending">
                <EntityStatusTag query={{isPending: true, isError: false}} />
            </Section>
            <Section label="error">
                <EntityStatusTag query={{isPending: false, isError: true}} />
            </Section>
            <Section label="ready">
                <EntityStatusTag query={{isPending: false, isError: false}} />
            </Section>
        </div>
    ),
}

export const FieldGrid: Story = {
    render: () => (
        <div className="flex max-w-[640px] flex-col">
            <Section label="values — number, verdict boolean, string">
                <EvaluatorFieldGrid
                    entries={[
                        ["score", 7.5],
                        ["success", true],
                        ["reasoning", "The answer covers every required field."],
                    ]}
                    outputPorts={OUTPUT_PORTS}
                />
            </Section>
            <Section label="values — failing verdict">
                <EvaluatorFieldGrid
                    entries={[
                        ["score", 0.2],
                        ["success", false],
                    ]}
                    outputPorts={OUTPUT_PORTS}
                />
            </Section>
            <Section label="loading — type-aware skeleton widths per port">
                <EvaluatorFieldGrid entries={null} outputPorts={OUTPUT_PORTS} loading />
            </Section>
            <Section label="loading — no ports, single bar fallback">
                <EvaluatorFieldGrid entries={null} outputPorts={[]} loading />
            </Section>
            <Section label="idle — labels with em-dash placeholders">
                <EvaluatorFieldGrid entries={null} outputPorts={OUTPUT_PORTS} idle />
            </Section>
            <Section label="score bounded by feedbackConfig (renders as 7.5 / 10)">
                <EvaluatorFieldGrid
                    entries={[["score", 7.5]]}
                    outputPorts={[port("score", "number")]}
                    feedbackConfig={{
                        json_schema: {
                            schema: {
                                properties: {score: {type: "number", minimum: 0, maximum: 10}},
                            },
                        },
                    }}
                />
            </Section>
        </div>
    ),
}

/** `headerActions` are hover-revealed (`opacity-0` until `group-hover/item`), so the actions
 *  row is present in the DOM but invisible in a static screenshot — that is the real behaviour. */
export const ResultCard: Story = {
    render: () => (
        <div className="flex max-w-[640px] flex-col gap-6 py-4">
            {(["idle", "running", "success", "error", "skipped"] as const).map((status) => (
                <NodeResultCard key={status} name="classify" version={3} status={status}>
                    <div className="text-xs text-colorText">
                        status <code>{status}</code> — idle, running, success and cancelled share
                        the neutral border; error is red, skipped is a dashed warning.
                    </div>
                </NodeResultCard>
            ))}
            <NodeResultCard
                name="summarise"
                version={1}
                isDraft
                headerActions={
                    <Button variant="ghost" size="sm" aria-label="Re-run node">
                        <ArrowClockwise size={12} />
                    </Button>
                }
            >
                <div className="text-xs text-colorText">draft tag plus a header action slot.</div>
            </NodeResultCard>
        </div>
    ),
}
