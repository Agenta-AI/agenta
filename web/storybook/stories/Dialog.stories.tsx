import {useState} from "react"

import {
    Button as ShadButton,
    Dialog,
    DialogTrigger,
    DialogContent,
    DialogHeader,
    DialogFooter,
    DialogTitle,
    DialogDescription,
    DialogClose,
} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Primitives/Overlays/Dialog",
    component: DialogContent,
    subcomponents: {
        Dialog,
        DialogTrigger,
        DialogHeader,
        DialogFooter,
        DialogTitle,
        DialogDescription,
        DialogClose,
    },
    parameters: {
        docs: {
            description: {
                component:
                    "The `@agenta/ui` Dialog (Radix-based) for modal content. It is a compound component — compose `Dialog` > `DialogContent` > `DialogHeader`/`DialogFooter`. Prop tables for each part are below.\n\n**Used in:** 2 places directly — `EnhancedModal` and the attachment `ImagePreview`. Its real reach is through `EnhancedModal`, which 42 files render (playground modals, deploy/commit/delete flows, settings, EE billing).",
            },
        },
    },
} satisfies Meta
export default meta
type Story = StoryObj

// Forced-OPEN state rendered INLINE (portal container) so the dialog stays inside the story
// canvas. A `transform` on the panel makes it the containing block for its fixed descendants
// (overlay + centered content). `open` goes on the Root and `container` on DialogContent.
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
                    <Dialog open>
                        <DialogContent
                            container={c}
                            onOpenAutoFocus={(e) => e.preventDefault()}
                            onCloseAutoFocus={(e) => e.preventDefault()}
                            onPointerDownOutside={(e) => e.preventDefault()}
                            onInteractOutside={(e) => e.preventDefault()}
                        >
                            <DialogHeader>
                                <DialogTitle>Modal title</DialogTitle>
                            </DialogHeader>
                            <DialogDescription>This is the modal body content.</DialogDescription>
                            <DialogFooter>
                                <DialogClose asChild>
                                    <ShadButton variant="outline">Cancel</ShadButton>
                                </DialogClose>
                                <ShadButton>OK</ShadButton>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                )}
            />
        </div>
    ),
}

// A real trigger-driven dialog (click to open).
export const Variants: Story = {
    render: () => (
        <div className="p-8">
            <Dialog>
                <DialogTrigger asChild>
                    <ShadButton variant="outline">Open</ShadButton>
                </DialogTrigger>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Modal title</DialogTitle>
                    </DialogHeader>
                    <DialogDescription>This is the modal body content.</DialogDescription>
                    <DialogFooter>
                        <DialogClose asChild>
                            <ShadButton variant="outline">Cancel</ShadButton>
                        </DialogClose>
                        <ShadButton>OK</ShadButton>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    ),
}
