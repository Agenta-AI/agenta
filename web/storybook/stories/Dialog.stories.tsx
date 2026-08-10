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
import {Modal as AntModal, Button as AntButton} from "antd"

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
                    "The `@agenta/ui` Dialog (Radix-based) that replaces antd `Modal`. It is a compound component — compose `Dialog` > `DialogContent` > `DialogHeader`/`DialogFooter`. Prop tables for each part are below.\n\n**Used in:** 2 places directly — `EnhancedModal` and the attachment `ImagePreview`. Its real reach is through `EnhancedModal`, which 42 files render (playground modals, deploy/commit/delete flows, settings, EE billing).",
            },
        },
    },
} satisfies Meta
export default meta
type Story = StoryObj

// Forced-OPEN state rendered INLINE (portal container) so antd and agenta dialogs sit side by
// side for static comparison. Both use `position: fixed`; a `transform` on the panel makes it
// the containing block for its fixed descendants (overlay + centered content), so each dialog
// is confined to its own column instead of both centering on the viewport.
// antd: `open` + `getContainer`. agenta: `open` (Root) + `container` on DialogContent.
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
                            getContainer={() => c}
                            // Resting-state comparison: antd's focus lock autofocuses the close X
                            // (4px colorPrimaryBorder ring) while the agenta side opts out below.
                            focusable={{trap: false}}
                            // The app's EnhancedModal renders 16px content radius — mirror it so
                            // the reference is the app modal, not antd's raw 10px borderRadiusLG.
                            styles={{container: {borderRadius: 16}}}
                            title="Modal title"
                            onCancel={() => {}}
                            footer={[
                                <AntButton key="cancel">Cancel</AntButton>,
                                <AntButton key="ok" type="primary">
                                    OK
                                </AntButton>,
                            ]}
                        >
                            <p>This is the modal body content.</p>
                        </AntModal>
                    )}
                />
            </div>
            <div>
                <div className="mb-2 text-[10px] text-colorTextSecondary">agenta</div>
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
                                <DialogDescription>
                                    This is the modal body content.
                                </DialogDescription>
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
        </div>
    ),
}

// Reference: real trigger-driven dialogs (click to open) side by side.
export const AntdVsAgenta: Story = {
    render: function AntdVsAgentaStory() {
        const [antOpen, setAntOpen] = useState(false)
        return (
            <div className="flex gap-24 p-8">
                <div className="flex flex-col gap-2">
                    <span className="text-[10px] text-colorTextSecondary">antd</span>
                    <AntButton onClick={() => setAntOpen(true)}>Open</AntButton>
                    <AntModal
                        open={antOpen}
                        styles={{container: {borderRadius: 16}}}
                        onCancel={() => setAntOpen(false)}
                        onOk={() => setAntOpen(false)}
                        title="Modal title"
                    >
                        <p>This is the modal body content.</p>
                    </AntModal>
                </div>
                <div className="flex flex-col gap-2">
                    <span className="text-[10px] text-colorTextSecondary">agenta</span>
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
            </div>
        )
    },
}
