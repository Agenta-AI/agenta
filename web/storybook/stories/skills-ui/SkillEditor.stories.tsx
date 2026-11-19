import {useState} from "react"

import {EMPTY_SKILL_DRAFT, SkillEditor, type SkillDraft} from "@agenta/skills-ui"
import {Button} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

const FILLED: SkillDraft = {
    name: "weekly-report",
    title: "Weekly report",
    description: "Use when someone asks for a weekly summary of the team's work.",
    body: "# Weekly report\n\n1. List what the team finished.\n2. List open questions.\n3. Keep it under one page.",
    files: [
        {path: "template.md", content: "## This week\n\n- "},
        {path: "scripts/collect.py", content: "print('collect')", executable: true},
    ],
    allowExecutable: false,
}

const Editor = ({initial, readOnly}: {initial: SkillDraft; readOnly?: boolean}) => {
    const [draft, setDraft] = useState(initial)
    return (
        <SkillEditor
            draft={draft}
            onChange={setDraft}
            readOnly={readOnly}
            actions={readOnly ? undefined : <Button>Save</Button>}
        />
    )
}

const meta = {
    title: "@agenta/skills-ui/SkillEditor",
    component: Editor,
    parameters: {layout: "padded"},
    args: {initial: EMPTY_SKILL_DRAFT},
} satisfies Meta<typeof Editor>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {}
export const WithFiles: Story = {args: {initial: FILLED}}
export const ReadOnly: Story = {args: {initial: FILLED, readOnly: true}}
export const DescriptionTooLong: Story = {
    args: {initial: {...FILLED, description: "x".repeat(1100)}},
}
