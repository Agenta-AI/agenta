import {useState} from "react"

import {EnhancedModal} from "@agenta/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Enhanced/Modal",
    component: EnhancedModal,
    parameters: {
        docs: {
            description: {
                component:
                    "A facade over the shadcn-based @agenta/ui Dialog; takes `title`, `okText`, `cancelText`, `footer` and `okButtonProps` props and renders a 16px-radius container.\n\n**Used in:** 42 places — the widest reach in the package. Playground modals (create/delete/deploy variant, refine prompt, keep-draft-rows), the entity commit/save/delete modals, testset and evaluation setup, app-management custom workflow and tracing setup, settings (vault, tools, account), and EE billing/pricing.",
            },
        },
    },
} satisfies Meta
export default meta
type Story = StoryObj

const BODY = "You are about to delete this item. This action cannot be undone."

function Panel({render}: {render: (c: HTMLElement) => React.ReactNode}) {
    const [el, setEl] = useState<HTMLElement | null>(null)
    return (
        <div ref={setEl} className="relative h-[360px] w-[560px] [transform:translateZ(0)]">
            {el && render(el)}
        </div>
    )
}

export const OpenState: Story = {
    render: () => (
        <div className="p-4">
            <Panel
                render={(c) => (
                    <EnhancedModal
                        open
                        getContainer={() => c}
                        focusable={{trap: false}}
                        title="Confirm deletion"
                        okText="Delete"
                        cancelText="Cancel"
                        okButtonProps={{danger: true}}
                        onCancel={() => {}}
                        onOk={() => {}}
                    >
                        <p className="m-0">{BODY}</p>
                    </EnhancedModal>
                )}
            />
        </div>
    ),
}
