import {useEffect, useState} from "react"

import {
    Button,
    Command,
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
    CommandShortcut,
} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Calculator, Calendar, CreditCard, Settings, Smile, User} from "lucide-react"

const meta = {
    title: "@agenta/ui/Primitives/Overlays/Command",
    component: Command,
    subcomponents: {
        CommandDialog,
        CommandInput,
        CommandList,
        CommandEmpty,
        CommandGroup,
        CommandItem,
        CommandSeparator,
        CommandShortcut,
    },
    parameters: {
        docs: {
            description: {
                component:
                    "The `@agenta/ui` Command palette (cmdk-based). Compose `Command` > `CommandInput` + `CommandList` > `CommandGroup` > `CommandItem`; `CommandDialog` wraps the same parts in a Dialog for a ⌘K palette. Rows share the DropdownMenu's geometry and `accent` highlight.",
            },
        },
    },
} satisfies Meta
export default meta
type Story = StoryObj

function Items() {
    return (
        <>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup heading="Suggestions">
                <CommandItem>
                    <Calendar />
                    <span>Calendar</span>
                </CommandItem>
                <CommandItem>
                    <Smile />
                    <span>Search Emoji</span>
                </CommandItem>
                <CommandItem disabled>
                    <Calculator />
                    <span>Calculator</span>
                </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Settings">
                <CommandItem>
                    <User />
                    <span>Profile</span>
                    <CommandShortcut>⌘P</CommandShortcut>
                </CommandItem>
                <CommandItem>
                    <CreditCard />
                    <span>Billing</span>
                    <CommandShortcut>⌘B</CommandShortcut>
                </CommandItem>
                <CommandItem>
                    <Settings />
                    <span>Settings</span>
                    <CommandShortcut>⌘S</CommandShortcut>
                </CommandItem>
            </CommandGroup>
        </>
    )
}

// Inline: the list in a bordered frame, the way a picker embeds it.
export const Inline: Story = {
    render: () => (
        <Command className="w-[320px] border border-solid border-border shadow-md">
            <CommandInput placeholder="Type a command or search..." />
            <CommandList>
                <Items />
            </CommandList>
        </Command>
    ),
}

// The ⌘K palette: a button opens it, and so does the shortcut.
export const InDialog: Story = {
    render: function InDialogStory() {
        const [open, setOpen] = useState(false)
        useEffect(() => {
            const down = (event: KeyboardEvent) => {
                if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault()
                    setOpen((prev) => !prev)
                }
            }
            document.addEventListener("keydown", down)
            return () => document.removeEventListener("keydown", down)
        }, [])
        return (
            <>
                <Button variant="outline" onClick={() => setOpen(true)}>
                    Open palette (⌘K)
                </Button>
                <CommandDialog open={open} onOpenChange={setOpen}>
                    <CommandInput placeholder="Type a command or search..." />
                    <CommandList>
                        <Items />
                    </CommandList>
                </CommandDialog>
            </>
        )
    },
}

// Nothing matches: the empty state stands in for the rows.
export const Empty: Story = {
    render: () => (
        <Command className="w-[320px] border border-solid border-border shadow-md">
            <CommandInput placeholder="Type a command or search..." value="zzz" />
            <CommandList>
                <Items />
            </CommandList>
        </Command>
    ),
}
