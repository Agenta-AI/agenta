import {useState} from "react"

import {EnhancedModal} from "@agenta/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Modal as AntModal} from "antd"

const meta = {
    title: "@agenta/ui/Enhanced/Modal",
    component: EnhancedModal,
    parameters: {
        docs: {
            description: {
                component:
                    "The antd-compatible facade over the @agenta/ui Dialog primitive; accepts antd Modal props (title/okText/footer/16px-radius container) while rendering the shadcn-based Dialog.\n\n**Used in:** 42 places — the widest reach in the package. Playground modals (create/delete/deploy variant, refine prompt, keep-draft-rows), the entity commit/save/delete modals, testset and evaluation setup, app-management custom workflow and tracing setup, settings (vault, tools, account), and EE billing/pricing.",
            },
        },
    },
} satisfies Meta
export default meta
type Story = StoryObj

// The parity reference is the app's OLD antd-based EnhancedModal config (radius 16 + flex-column
// container capped at 90vh + scrollable body + fixed footer). The agenta side is the new facade
// (EnhancedModal → @agenta/ui Dialog). Same title/body/footer → they must render identically.
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
        <div className="flex gap-16 p-4" data-open-compare>
            <div>
                <div className="mb-2 text-[10px] text-colorTextSecondary">antd</div>
                <Panel
                    render={(c) => (
                        <AntModal
                            open
                            centered
                            getContainer={() => c}
                            // Resting-state comparison: whichever side keeps its open-autofocus
                            // paints a focus ring, so BOTH opt out (see the agenta side below).
                            focusable={{trap: false}}
                            title="Confirm deletion"
                            okText="Delete"
                            cancelText="Cancel"
                            okButtonProps={{danger: true}}
                            style={{borderRadius: 16}}
                            styles={{
                                container: {
                                    display: "flex",
                                    flexDirection: "column",
                                    maxHeight: "90vh",
                                    borderRadius: 16,
                                },
                                body: {overflowY: "auto", flex: 1, minHeight: 0},
                                footer: {flexShrink: 0},
                            }}
                            onCancel={() => {}}
                            onOk={() => {}}
                        >
                            <p className="m-0">{BODY}</p>
                        </AntModal>
                    )}
                />
            </div>
            <div>
                <div className="mb-2 text-[10px] text-colorTextSecondary">agenta</div>
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
        </div>
    ),
}
