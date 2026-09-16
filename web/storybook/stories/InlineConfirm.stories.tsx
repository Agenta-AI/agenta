import {useState} from "react"

import {Button, InlineConfirm} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

// No antd counterpart: antd's confirm step is a Popconfirm, and the point of this one is that it
// is NOT a popover — it renders under the control that opened it, so the row it describes stays
// visible on a phone.
const meta = {
    title: "@agenta/ui/Primitives/Feedback/InlineConfirm",
    component: InlineConfirm,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A confirm step rendered in place, for a destructive action whose consequence fits in one sentence. Escape cancels, and focus opens on Cancel so a keyboard user who arrived by pressing Enter does not confirm with a second Enter.\n\n**Used in:** the MCP permission drawer's `Remove from agent`.",
            },
        },
    },
    args: {
        message: "Remove linear from this agent? The connection stays in the project.",
        confirmLabel: "Remove",
        onConfirm: () => {},
        onCancel: () => {},
    },
} satisfies Meta<typeof InlineConfirm>

export default meta
type Story = StoryObj<typeof meta>

export const Open: Story = {
    render: (args) => (
        <div className="w-[420px]" data-vrt-subject>
            <InlineConfirm {...args} />
        </div>
    ),
}

// The state the component is actually seen in: a link that swaps itself for the confirm.
export const FromALink: Story = {
    render: (args) => {
        const Demo = () => {
            const [confirming, setConfirming] = useState(false)
            return (
                <div
                    className="flex w-[420px] flex-col items-start gap-2 border border-solid border-colorBorderSecondary p-4"
                    data-vrt-subject
                >
                    <Button
                        variant="link"
                        size="sm"
                        className="text-colorError"
                        onClick={() => setConfirming(true)}
                    >
                        Remove from agent
                    </Button>
                    {confirming ? (
                        <InlineConfirm
                            {...args}
                            onConfirm={() => setConfirming(false)}
                            onCancel={() => setConfirming(false)}
                        />
                    ) : null}
                </div>
            )
        }
        return <Demo />
    },
}
