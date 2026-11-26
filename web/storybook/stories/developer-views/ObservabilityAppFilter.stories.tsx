import {useState} from "react"

import type {Meta, StoryObj} from "@storybook/nextjs"

import {
    AppFilterSelect,
    type AppFilterOption,
} from "../../../mobile/src/features/observability/ObservabilityAppFilter"

// The picker /m puts in the Observability toolbar when the "Filter by app" developer view is on.
// These stories render the presentational `AppFilterSelect`: the connected component only adds
// the apps list the nav already loads, and hides itself when that list fails.
const meta = {
    title: "@agenta/mobile/Developer/AppFilter/ObservabilityAppFilter",
    component: AppFilterSelect,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The app picker in the Observability toolbar. The first option is All apps (the whole project); each other option is one app, with its glyph. It is a disabled select while the apps list loads, and the connected component hides it when the list fails.\n\n**Used in:** the /m Observability page, behind the `observability-app-filter` developer view.",
            },
        },
    },
} satisfies Meta<typeof AppFilterSelect>

export default meta
type Story = StoryObj<typeof meta>

const APPS: AppFilterOption[] = [
    {id: "support", name: "Support agent"},
    {id: "summarizer", name: "Summarizer"},
    {id: "router", name: "Ticket router"},
]

const MANY_APPS: AppFilterOption[] = Array.from({length: 24}, (_, index) => ({
    id: `app-${index + 1}`,
    name: `Customer workflow ${index + 1}`,
}))

const Controlled = ({
    apps,
    initial = null,
    disabled,
}: {
    apps: AppFilterOption[]
    initial?: string | null
    disabled?: boolean
}) => {
    const [value, setValue] = useState<string | null>(initial)
    return <AppFilterSelect apps={apps} value={value} disabled={disabled} onChange={setValue} />
}

/** Radix opens a select on Enter, so a play function can show the list without a pointer. */
const openList = async ({canvasElement}: {canvasElement: HTMLElement}) => {
    const trigger = canvasElement.querySelector<HTMLElement>("[role='combobox']")
    trigger?.focus()
    trigger?.dispatchEvent(
        new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}),
    )
}

const args = {apps: APPS, value: null, onChange: () => {}}

export const Loading: Story = {
    args,
    render: () => <Controlled apps={[]} disabled />,
}

export const AllApps: Story = {
    args,
    render: () => <Controlled apps={APPS} />,
}

export const AppSelected: Story = {
    args,
    render: () => <Controlled apps={APPS} initial="summarizer" />,
}

export const OpenList: Story = {
    args,
    render: () => <Controlled apps={APPS} initial="support" />,
    play: openList,
}

export const ManyApps: Story = {
    args,
    render: () => <Controlled apps={MANY_APPS} initial="app-3" />,
    play: openList,
}

export const Phone390: Story = {
    args,
    render: () => (
        <div className="w-[390px] max-w-full border border-dashed border-border p-4">
            <Controlled apps={APPS} initial="support" />
        </div>
    ),
    play: openList,
}
