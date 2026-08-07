import {useState} from "react"

import {EnhancedDrawer} from "@agenta/ui/drawer"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Button as AntButton, Drawer as AntDrawer} from "antd"

const meta = {
    title: "@agenta/ui/Enhanced/Drawer",
    component: EnhancedDrawer,
    parameters: {
        docs: {
            description: {
                component:
                    "The antd-compatible facade over the @agenta/ui Sheet primitive; accepts antd Drawer props (placement/title/footer) while rendering the shadcn-based Sheet.\n\n**Used in:** 23 places — effectively every app drawer: trace, session, annotate, files, webhooks, deployments, eval-run details, model registry, agent inspector and the EE audit-event drawer, plus the `@agenta/entity-ui` config, instructions, trigger and testcase drawers.",
            },
        },
    },
} satisfies Meta
export default meta
type Story = StoryObj

// Reference = the app's antd Drawer (the EnhancedDrawer wrapper's mask{blur:false}/width→wrapper are
// behavioral, not visual). The agenta side is the new facade (EnhancedDrawer → @agenta/ui Sheet).
// Same title/body/footer → identical render. Panel `transform` confines the fixed panel to its column.
const BODY = "Drawer body content. This scrolls internally when it exceeds the panel height."
const FOOTER = (
    <div className="flex justify-end gap-2">
        <AntButton>Cancel</AntButton>
        <AntButton type="primary">Save</AntButton>
    </div>
)

function Panel({render}: {render: (c: HTMLElement) => React.ReactNode}) {
    const [el, setEl] = useState<HTMLElement | null>(null)
    return (
        <div ref={setEl} className="relative h-[420px] w-[520px] [transform:translateZ(0)]">
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
                        <AntDrawer
                            open
                            placement="right"
                            getContainer={() => c}
                            title="Drawer title"
                            footer={FOOTER}
                            onClose={() => {}}
                        >
                            {BODY}
                        </AntDrawer>
                    )}
                />
            </div>
            <div>
                <div className="mb-2 text-[10px] text-colorTextSecondary">agenta</div>
                <Panel
                    render={(c) => (
                        <EnhancedDrawer
                            open
                            placement="right"
                            getContainer={() => c}
                            title="Drawer title"
                            footer={FOOTER}
                            onClose={() => {}}
                        >
                            {BODY}
                        </EnhancedDrawer>
                    )}
                />
            </div>
        </div>
    ),
}
