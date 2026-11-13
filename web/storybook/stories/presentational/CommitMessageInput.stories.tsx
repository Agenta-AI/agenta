import {useState} from "react"

import {CommitMessageInput} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Presentational/Forms/CommitMessageInput",
    component: CommitMessageInput,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A labeled autosize textarea with a character counter, used by commit/deploy/revert modals. A pure @agenta/ui composite.\n\n**Used in:** 6 places — the playground create-variant and deploy-variant modals, the deployments confirmation modal and deploy-variant selector, the testset commit modal, and the shared entity commit modal.",
            },
        },
    },
} satisfies Meta<typeof CommitMessageInput>

export default meta
type Story = StoryObj

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[10rem_20rem] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="h-[104px] w-[320px]">{children}</div>
    </div>
)

const Controlled = ({disabled}: {disabled?: boolean}) => {
    const [value, setValue] = useState("")
    return <CommitMessageInput value={value} onChange={setValue} disabled={disabled} />
}

export const Variants: Story = {
    render: () => (
        <div className="flex w-[736px] flex-col">
            <Row label="default">
                <Controlled />
            </Row>
            <Row label="disabled">
                <Controlled disabled />
            </Row>
        </div>
    ),
}
