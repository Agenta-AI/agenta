import {useState} from "react"

import {
    AlertDialog,
    AlertDialogTrigger,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogFooter,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogAction,
    AlertDialogCancel,
    buttonVariants,
    Button as ShadButton,
} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Trash2} from "lucide-react"

const meta = {
    title: "@agenta/ui/Primitives/Overlays/AlertDialog",
    component: AlertDialogContent,
    subcomponents: {
        AlertDialog,
        AlertDialogTrigger,
        AlertDialogHeader,
        AlertDialogFooter,
        AlertDialogTitle,
        AlertDialogDescription,
        AlertDialogAction,
        AlertDialogCancel,
    },
    parameters: {
        docs: {
            description: {
                component:
                    "The `@agenta/ui` AlertDialog (Radix-based) for confirm prompts. It is a compound component — compose `AlertDialog` > `AlertDialogContent` > header/footer/action/cancel. Prop tables for each part are below.\n\n**Used in:** 1 place — the global app-message host (`@agenta/ui/app-message` `AppMessageRenderer`), which backs the app-wide confirm dialog. No file composes the parts directly.",
            },
        },
    },
} satisfies Meta
export default meta
type Story = StoryObj

// Forced-OPEN state rendered INLINE (portal container) so the dialog stays inside the story
// canvas. A `transform` on the panel makes it the containing block for the fixed overlay and the
// centered content.
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
                    <AlertDialog open>
                        <AlertDialogContent
                            container={c}
                            onOpenAutoFocus={(e) => e.preventDefault()}
                            onCloseAutoFocus={(e) => e.preventDefault()}
                        >
                            <AlertDialogHeader>
                                <AlertDialogTitle>Confirm deletion</AlertDialogTitle>
                            </AlertDialogHeader>
                            <AlertDialogDescription>
                                This action cannot be undone.
                            </AlertDialogDescription>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                    className={buttonVariants({variant: "destructive"})}
                                >
                                    <Trash2 className="size-3.5" />
                                    Delete
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                )}
            />
        </div>
    ),
}

// A real trigger-driven confirm dialog (click to open).
export const Variants: Story = {
    render: () => (
        <div className="p-8">
            <AlertDialog>
                <AlertDialogTrigger asChild>
                    <ShadButton variant="outline">Delete</ShadButton>
                </AlertDialogTrigger>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Confirm deletion</AlertDialogTitle>
                    </AlertDialogHeader>
                    <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction className={buttonVariants({variant: "destructive"})}>
                            <Trash2 className="size-3.5" />
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    ),
}
