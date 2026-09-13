import {useState} from "react"

import {SkillPickerDrawer, type SkillListItem} from "@agenta/skills-ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

// The add-skills picker (artboard 4b): AddSubagentDrawer anatomy plus the split
// [Add | ▾] (follow latest vs pin) and the footer `+ New skill ▾`.
const meta = {
    title: "@agenta/skills-ui/SkillPickerDrawer",
    component: SkillPickerDrawer,
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "Pick registry skills for an agent. Plain Add follows latest; the row " +
                    "caret offers pinning — version choice stays behind progressive " +
                    "disclosure. Added rows flip to Remove; Add all acts on the visible rows.",
            },
        },
    },
} satisfies Meta<typeof SkillPickerDrawer>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const OPTIONS: SkillListItem[] = [
    {
        id: "s1",
        slug: "pdf-tools",
        name: "PDF tools",
        description: "Extract text, merge, and split PDF documents.",
        origin: "project",
        version: "3",
    },
    {
        id: "s2",
        slug: "release-notes",
        name: "Release notes",
        description: "Draft release notes from merged PRs in the house style.",
        origin: "project",
        version: "1",
        added: true,
    },
    {
        id: "s3",
        slug: "commit-helper",
        name: "Commit helper",
        description: "Conventional-commit message guidance.",
        origin: "imported",
        version: "2",
        added: true,
        pinnedVersion: "1",
    },
    {
        id: "s4",
        slug: "__ag__web-search",
        name: "Web search",
        description: "Search the web and cite sources.",
        origin: "builtin",
    },
]

function PickerHarness({options}: {options: SkillListItem[]}) {
    const [open, setOpen] = useState(true)
    return (
        <SkillPickerDrawer
            open={open}
            onClose={() => setOpen(false)}
            options={options}
            onAdd={noop}
            onRemove={noop}
            createActions={{onWrite: noop, onUpload: noop, onImport: noop}}
        />
    )
}

export const Mixed: Story = {
    args: {} as never,
    render: () => <PickerHarness options={OPTIONS} />,
}

export const Empty: Story = {
    args: {} as never,
    render: () => <PickerHarness options={[]} />,
}
