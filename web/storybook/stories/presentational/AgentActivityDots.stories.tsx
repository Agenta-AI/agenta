import {useEffect, useState} from "react"

import {AgentActivityDots, type AgentActivityFormat} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"

// AgentActivityDots — three dots orbiting in 3D, one motion per kind of agent work.
const meta = {
    title: "@agenta/ui/Presentational/Status/AgentActivityDots",
    component: AgentActivityDots,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The live run indicator. Paints in `currentColor` (the brand primary by default). Omit `format` for a generic loader that cycles through the formats at random. Under reduced motion it shows a still row of dots with an opacity pulse.\n\n**Used in:** the agent chat activity timeline header, while a turn runs.",
            },
        },
    },
    args: {format: "thinking", size: 18},
    argTypes: {
        format: {
            control: "select",
            options: [
                "working",
                "thinking",
                "tool",
                "searching",
                "planning",
                "subagents",
                "evaluating",
                "writing",
            ],
        },
        size: {control: {type: "range", min: 10, max: 96, step: 2}},
    },
} satisfies Meta<typeof AgentActivityDots>

export default meta
type Story = StoryObj<typeof meta>

const FORMATS: {format: AgentActivityFormat; label: string}[] = [
    {format: "working", label: "Working"},
    {format: "thinking", label: "Thinking"},
    {format: "tool", label: "Running a command"},
    {format: "searching", label: "Searching files"},
    {format: "planning", label: "Planning steps"},
    {format: "subagents", label: "Running sub-agents"},
    {format: "evaluating", label: "Scoring outputs"},
    {format: "writing", label: "Writing"},
]

export const Playground: Story = {}

/** No `format`: a generic loader that switches to a random format every few seconds. */
export const Auto: Story = {
    render: () => (
        <div className="flex flex-col items-start gap-6">
            <AgentActivityDots size={96} />
            <span className="flex items-center gap-2.5 text-[13px] text-colorTextSecondary">
                <AgentActivityDots />
                Loading
            </span>
        </div>
    ),
}

/** Every format at once, large and at the 18px it ships at beside a 13px label. */
export const AllFormats: Story = {
    render: () => (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4">
            {FORMATS.map(({format, label}) => (
                <div
                    key={format}
                    className="flex flex-col items-center gap-3 rounded-lg border border-solid border-colorBorderSecondary p-4"
                >
                    <AgentActivityDots format={format} size={72} />
                    <span className="flex items-center gap-2.5 text-[13px] text-colorTextSecondary">
                        <AgentActivityDots format={format} size={18} />
                        {label}
                    </span>
                </div>
            ))}
        </div>
    ),
}

/** Cycles through the formats the way a run does, so the merge-and-burst switch plays. */
export const Switching: Story = {
    render: function Switching() {
        const [i, setI] = useState(0)
        useEffect(() => {
            const id = setInterval(() => setI((n) => (n + 1) % FORMATS.length), 2400)
            return () => clearInterval(id)
        }, [])
        return (
            <div className="flex flex-col items-start gap-6">
                <AgentActivityDots format={FORMATS[i].format} size={96} />
                <span className="flex items-center gap-2.5 text-[13px] text-colorTextSecondary">
                    <AgentActivityDots format={FORMATS[i].format} size={18} />
                    {FORMATS[i].label}
                </span>
            </div>
        )
    },
}
