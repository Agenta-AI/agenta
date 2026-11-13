import {useState} from "react"

import type {Meta, StoryObj} from "@storybook/nextjs"

import {
    AddToQueuePickerPanel,
    type AddToQueuePickerPanelProps,
    type PickerQueue,
} from "../../../mobile/src/features/annotations/AddToQueuePickerPanel"

const meta = {
    title: "mobile/AddToQueuePicker",
    component: AddToQueuePickerPanel,
    parameters: {
        layout: "centered",
        docs: {
            description: {
                component:
                    "The body of the shadcn add-to-queue picker that `/m` registers in the trace drawer's `AddToQueuePopover` slot. It shows a search box over the project's queues of one kind.\n\n**Used in:** 2 places in `web/mobile` — the trace drawer header and the observability toolbar.",
            },
        },
    },
} satisfies Meta<typeof AddToQueuePickerPanel>

export default meta
type Story = StoryObj<typeof meta>

const QUEUES: PickerQueue[] = [
    {id: "q-1", name: "Support triage", updated: "Updated 2 hours ago"},
    {
        id: "q-2",
        name: "Refund disputes with a very long name that must be cut off",
        updated: "Updated 3 days ago",
    },
    {id: "q-3", name: "Weekly sample", updated: "Updated a month ago"},
    {id: "q-4", name: "Hallucination review", updated: "Updated 2 months ago"},
]

const Frame = (props: Partial<AddToQueuePickerPanelProps>) => {
    const [search, setSearch] = useState(props.search ?? "")
    const term = search.trim().toLowerCase()
    const queues = (props.queues ?? QUEUES).filter((q) => q.name.toLowerCase().includes(term))
    return (
        <div className="w-[min(20rem,calc(100vw-2rem))] rounded-control-lg bg-popover text-popover-foreground shadow-overlay">
            <AddToQueuePickerPanel
                status="ready"
                submittingId={null}
                emptyMessage="No trace queues"
                onSelect={() => undefined}
                onRetry={() => undefined}
                {...props}
                queues={queues}
                search={search}
                onSearchChange={setSearch}
            />
        </div>
    )
}

export const Default: Story = {render: () => <Frame />, args: {} as never}

export const NoMatch: Story = {render: () => <Frame search="zzz" />, args: {} as never}

export const Loading: Story = {render: () => <Frame status="loading" />, args: {} as never}

export const Empty: Story = {render: () => <Frame queues={[]} />, args: {} as never}

export const LoadError: Story = {render: () => <Frame status="error" />, args: {} as never}

export const Adding: Story = {render: () => <Frame submittingId="q-1" />, args: {} as never}
