import {useState} from "react"

import {
    Button as ShadButton,
    Sheet,
    SheetTrigger,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetFooter,
} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Drawer as AntDrawer, Button as AntButton} from "antd"

const meta = {
    title: "@agenta/ui/Primitives/Overlays/Sheet",
    component: SheetContent,
    subcomponents: {Sheet, SheetTrigger, SheetHeader, SheetFooter, SheetTitle},
    parameters: {
        docs: {
            description: {
                component:
                    "The `@agenta/ui` Sheet (Radix-based) that replaces antd `Drawer`. It is a compound component — compose `Sheet` > `SheetContent` > `SheetHeader`/`SheetFooter`. Prop tables for each part are below.\n\n**Used in:** 1 place directly — `EnhancedDrawer`, which in turn backs all 23 app drawers.",
            },
        },
    },
} satisfies Meta
export default meta
type Story = StoryObj

// Body copy shared by both halves.
const BODY =
    "A Sheet slides in from a screen edge — antd calls it a Drawer. Use it for filters, details, and forms that don't warrant a full page."

// Forced-OPEN state rendered INLINE (portal container) so antd and agenta panels sit side by
// side for static comparison. Both use `position: fixed`; a `transform` on the box makes it the
// containing block for its fixed descendants (overlay + edge-pinned content), so each panel is
// confined to its own column instead of pinning to the viewport edge.
// antd: `open` + `getContainer`. agenta: `open` (Root) + `container` on SheetContent.
function Panel({
    w = "w-[560px]",
    h = "h-[360px]",
    render,
}: {
    w?: string
    h?: string
    render: (c: HTMLElement) => React.ReactNode
}) {
    const [el, setEl] = useState<HTMLElement | null>(null)
    return (
        <div ref={setEl} className={`relative ${w} ${h} [transform:translateZ(0)]`}>
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
                            onClose={() => {}}
                            title="Panel title"
                            footer={
                                <div className="flex justify-end gap-2">
                                    <AntButton>Cancel</AntButton>
                                    <AntButton type="primary">OK</AntButton>
                                </div>
                            }
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
                        <Sheet open>
                            <SheetContent container={c} side="right">
                                <SheetHeader>
                                    <SheetTitle>Panel title</SheetTitle>
                                </SheetHeader>
                                <div className="flex-1 overflow-auto px-6 py-6 text-field-md text-colorText">
                                    {BODY}
                                </div>
                                <SheetFooter>
                                    <ShadButton variant="outline">Cancel</ShadButton>
                                    <ShadButton>OK</ShadButton>
                                </SheetFooter>
                            </SheetContent>
                        </Sheet>
                    )}
                />
            </div>
        </div>
    ),
}

// The four `side` variants (agenta), each forced open in its own containing box. A square box
// gives every side a visible mask gutter (378px panel in a 460px box).
const SIDES = ["right", "left", "top", "bottom"] as const

export const Sides: Story = {
    render: () => (
        <div className="flex flex-wrap gap-16 p-4">
            {SIDES.map((side) => (
                <div key={side}>
                    <div className="mb-2 text-[10px] text-colorTextSecondary">
                        side=&quot;{side}&quot;
                    </div>
                    <Panel
                        w="w-[460px]"
                        h="h-[460px]"
                        render={(c) => (
                            <Sheet open>
                                <SheetContent container={c} side={side}>
                                    <SheetHeader>
                                        <SheetTitle>{side}</SheetTitle>
                                    </SheetHeader>
                                    <div className="flex-1 overflow-auto px-6 py-6 text-field-md text-colorText">
                                        {BODY}
                                    </div>
                                </SheetContent>
                            </Sheet>
                        )}
                    />
                </div>
            ))}
        </div>
    ),
}

// Reference: real trigger-driven Sheet vs antd Drawer (click to open), portaled to the viewport.
export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex gap-24 p-8">
            <div className="flex flex-col gap-2">
                <span className="text-[10px] text-colorTextSecondary">antd</span>
                <AntdTriggered />
            </div>
            <div className="flex flex-col gap-2">
                <span className="text-[10px] text-colorTextSecondary">agenta</span>
                <Sheet>
                    <SheetTrigger asChild>
                        <ShadButton variant="outline">Open sheet</ShadButton>
                    </SheetTrigger>
                    <SheetContent side="right">
                        <SheetHeader>
                            <SheetTitle>Panel title</SheetTitle>
                        </SheetHeader>
                        <div className="flex-1 overflow-auto px-6 py-6 text-field-md text-colorText">
                            {BODY}
                        </div>
                    </SheetContent>
                </Sheet>
            </div>
        </div>
    ),
}

function AntdTriggered() {
    const [open, setOpen] = useState(false)
    return (
        <>
            <AntButton onClick={() => setOpen(true)}>Open drawer</AntButton>
            <AntDrawer
                open={open}
                onClose={() => setOpen(false)}
                placement="right"
                title="Panel title"
            >
                {BODY}
            </AntDrawer>
        </>
    )
}
