import {useState} from "react"

import {EnhancedDrawer} from "@agenta/ui/drawer"
import {Button} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Enhanced/Drawer",
    component: EnhancedDrawer,
    parameters: {
        docs: {
            description: {
                component:
                    "A facade over the shadcn-based @agenta/ui Sheet; takes `placement`, `title` and `footer` props.\n\n**Used in:** 23 places — effectively every app drawer: trace, session, annotate, files, webhooks, deployments, eval-run details, model registry, agent inspector and the EE audit-event drawer, plus the `@agenta/entity-ui` config, instructions, trigger and testcase drawers.",
            },
        },
    },
} satisfies Meta
export default meta
type Story = StoryObj

// The panel `transform` confines the fixed drawer to the story canvas.
const BODY = "Drawer body content. This scrolls internally when it exceeds the panel height."
const FOOTER = (
    <div className="flex justify-end gap-2">
        <Button variant="outline">Cancel</Button>
        <Button>Save</Button>
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
        <div className="p-4">
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
    ),
}
