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
import {Dropdown as AntDropdown, Button as AntButton} from "antd"
import type {MenuProps} from "antd"

const meta = {
    title: "@agenta/ui/Primitives/Overlays/Dropdown",
    component: DropdownMenuContent,
    subcomponents: {DropdownMenu, DropdownMenuTrigger, DropdownMenuItem, DropdownMenuSeparator},
    parameters: {
        docs: {
            description: {
                component:
                    "The `@agenta/ui` DropdownMenu (Radix-based) that replaces antd `Dropdown`. Compose `DropdownMenu` > `DropdownMenuTrigger` + `DropdownMenuContent` > `DropdownMenuItem`. Prop tables for each part are below.\n\n**Used in:** 8 places — `DropdownButton` and `SimpleDropdownSelect`, the chat attachment button, the Lexical editor toolbar and its array/object form nodes, and the drill-in breadcrumb plus view-mode dropdown.",
            },
        },
    },
} satisfies Meta
export default meta
type Story = StoryObj

// Same item set both sides: a few items + a separator + a disabled item.
const ANT_ITEMS: MenuProps["items"] = [
    {key: "edit", label: "Edit"},
    {key: "duplicate", label: "Duplicate"},
    {type: "divider"},
    {key: "delete", label: "Delete", disabled: true},
]

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

// Forced-OPEN state rendered INLINE (portal container) so antd and agenta menus sit side by
// side for static comparison. antd: `open` + `getPopupContainer`. agenta: `open` (Root) +
// `container` on DropdownMenuContent.
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
        <div className="flex gap-24 p-4" data-open-compare>
            <div>
                <div className="mb-2 text-[10px] text-colorTextSecondary">antd</div>
                <Panel
                    render={(c) => (
                        <AntDropdown open getPopupContainer={() => c} menu={{items: ANT_ITEMS}}>
                            <AntButton>Actions</AntButton>
                        </AntDropdown>
                    )}
                />
            </div>
            <div>
                <div className="mb-2 text-[10px] text-colorTextSecondary">agenta</div>
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
        </div>
    ),
}

// Reference: real trigger-driven menus (click to open) side by side.
export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex gap-24 p-8">
            <div className="flex flex-col gap-2">
                <span className="text-[10px] text-colorTextSecondary">antd</span>
                <AntDropdown menu={{items: ANT_ITEMS}} trigger={["click"]}>
                    <AntButton>Actions</AntButton>
                </AntDropdown>
            </div>
            <div className="flex flex-col gap-2">
                <span className="text-[10px] text-colorTextSecondary">agenta</span>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <ShadButton variant="outline">Actions</ShadButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                        <ShadItems />
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>
    ),
}
