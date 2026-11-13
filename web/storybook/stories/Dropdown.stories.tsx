import {useState} from "react"

import {
    Button as ShadButton,
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Primitives/Overlays/Dropdown",
    component: DropdownMenuContent,
    subcomponents: {DropdownMenu, DropdownMenuTrigger, DropdownMenuItem, DropdownMenuSeparator},
    parameters: {
        docs: {
            description: {
                component:
                    "The `@agenta/ui` DropdownMenu (Radix-based) for action menus. Compose `DropdownMenu` > `DropdownMenuTrigger` + `DropdownMenuContent` > `DropdownMenuItem`. Prop tables for each part are below.\n\n**Used in:** 8 places — `DropdownButton` and `SimpleDropdownSelect`, the chat attachment button, the Lexical editor toolbar and its array/object form nodes, and the drill-in breadcrumb plus view-mode dropdown.",
            },
        },
    },
} satisfies Meta
export default meta
type Story = StoryObj

// A few items + a separator + a disabled item.
function ShadItems() {
    return (
        <>
            <DropdownMenuItem>Edit</DropdownMenuItem>
            <DropdownMenuItem>Duplicate</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>Delete</DropdownMenuItem>
        </>
    )
}

// Forced-OPEN state rendered INLINE (portal container) so the menu stays inside the story
// canvas: `open` on the Root and `container` on DropdownMenuContent.
function Panel({render}: {render: (c: HTMLElement) => React.ReactNode}) {
    const [el, setEl] = useState<HTMLElement | null>(null)
    return (
        <div ref={setEl} className="relative min-h-[180px] w-[220px]">
            {el && render(el)}
        </div>
    )
}

export const OpenState: Story = {
    render: () => (
        <div className="p-4">
            <Panel
                render={(c) => (
                    <DropdownMenu open>
                        <DropdownMenuTrigger asChild>
                            <ShadButton variant="outline">Actions</ShadButton>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent container={c}>
                            <ShadItems />
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            />
        </div>
    ),
}

// A real trigger-driven menu (click to open).
export const Variants: Story = {
    render: () => (
        <div className="p-8">
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <ShadButton variant="outline">Actions</ShadButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                    <ShadItems />
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    ),
}
