import {message} from "@agenta/ui/app-message"
import {Button, Toaster} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

// `message.*` drives the kit's Toaster, which the global AgentaProviders decorator already mounts.
const meta = {
    title: "@agenta/ui/Primitives/Feedback/Toast",
    component: Toaster,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The `@agenta/ui` Toaster (Sonner in the shadcn toast look) that every `message.*` call renders into. Toasts stack top-centre, expand on hover and swipe to dismiss.",
            },
        },
    },
} satisfies Meta<typeof Toaster>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {
    render: () => (
        <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => message.info("Event created")}>
                Default
            </Button>
            <Button variant="outline" onClick={() => message.success("Event created")}>
                Success
            </Button>
            <Button variant="outline" onClick={() => message.warning("Event created")}>
                Warning
            </Button>
            <Button variant="outline" onClick={() => message.error("Event could not be created")}>
                Error
            </Button>
            <Button variant="outline" onClick={() => message.loading("Creating event…", 3)}>
                Loading
            </Button>
            <Button
                variant="outline"
                onClick={() =>
                    message.open({
                        content: "Event created",
                        type: "success",
                        action: {label: "Undo", onClick: () => message.info("Undone")},
                    })
                }
            >
                With action
            </Button>
            <Button
                variant="outline"
                onClick={() => {
                    message.info("First", 10)
                    setTimeout(() => message.success("Second", 10), 300)
                    setTimeout(() => message.warning("Third", 10), 600)
                }}
            >
                Stack of three
            </Button>
        </div>
    ),
}
