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

const meta = {
    title: "@agenta/ui/Primitives/Overlays/Sheet",
    component: SheetContent,
    subcomponents: {Sheet, SheetTrigger, SheetHeader, SheetFooter, SheetTitle},
    parameters: {
        docs: {
            description: {
                component:
                    "The `@agenta/ui` Sheet (Radix-based) for side panels and bottom sheets. It is a compound component — compose `Sheet` > `SheetContent` > `SheetHeader`/`SheetFooter`. Prop tables for each part are below.\n\nThe `left` and `right` sides float: 8px in from the viewport, rounded, with no border. The close button sits at the right of the header (`showCloseButton={false}` on `SheetHeader` hides it), and the footer is a muted band. `top` and `bottom` stay edge to edge. `responsive` is a bottom sheet below `lg` and the floating right drawer from `lg` up.\n\n**Used in:** `EnhancedDrawer`, which backs the app drawers, and directly by the /m sheets (navigation, session inspector, Publish, settings forms).",
            },
        },
    },
} satisfies Meta
export default meta
type Story = StoryObj

// Body copy shared by every story.
const BODY =
    "A Sheet slides in from a screen edge. Use it for filters, details, and forms that don't warrant a full page."

// Forced-OPEN state rendered INLINE (portal container) so each panel stays inside the story
// canvas. Both use `position: fixed`; a `transform` on the box makes it the containing block for
// its fixed descendants (overlay + edge-pinned content), so each panel is confined to its own
// box instead of pinning to the viewport edge. `open` goes on the Root and `container` on
// SheetContent.
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
        <div className="p-4">
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
    ),
}

// The four `side` variants each forced open in its own containing box. A square box
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

// The fifth side. It is a VIEWPORT rule, not a container one, so this story portals to the
// viewport and changes shape with the Storybook viewport toolbar: a bottom sheet at phone widths,
// the right-edge drawer from 1024px up. Rendering it in a boxed column like `Sides` would show
// the desktop half at every width, which is exactly the mistake the variant exists to prevent.
export const Responsive: Story = {
    parameters: {
        docs: {
            description: {
                story: '`side="responsive"` — a bottom sheet below `lg` and the app\'s right-edge drawer from `lg` up. Resize the preview or use the viewport toolbar to see both halves. `EnhancedDrawer` exposes it as `placement="responsive"`, and a `width` there applies to the drawer half only.',
            },
        },
    },
    render: () => (
        <div className="p-8">
            <Sheet>
                <SheetTrigger asChild>
                    <ShadButton variant="outline">Open responsive panel</ShadButton>
                </SheetTrigger>
                <SheetContent side="responsive">
                    <SheetHeader>
                        <SheetTitle>Add MCP server</SheetTitle>
                    </SheetHeader>
                    <div className="flex-1 overflow-auto px-6 py-6 text-field-md text-colorText">
                        {BODY}
                    </div>
                    <SheetFooter>
                        <ShadButton variant="outline">Cancel</ShadButton>
                        <ShadButton>Add</ShadButton>
                    </SheetFooter>
                </SheetContent>
            </Sheet>
        </div>
    ),
}

// A real trigger-driven Sheet (click to open), portaled to the viewport.
export const Variants: Story = {
    render: () => (
        <div className="p-8">
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
    ),
}
