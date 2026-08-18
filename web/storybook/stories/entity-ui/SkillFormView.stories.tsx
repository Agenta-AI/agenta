import {useState} from "react"

import {SkillFormView} from "@agenta/entity-ui/drill-in"
import type {Meta, StoryObj} from "@storybook/nextjs"

// SkillFormView — the folder-shaped inline-skill editor: a Files rail (SKILL.md pinned, the
// bundled files, the SkillUploadZone) beside the skill-level fields, the selected file's
// editor and the two behaviour toggles.
//
// antd swaps in THIS file: `App.useApp().message` → the antd-free `message` service from
// `@agenta/ui/app-message` (the same singleton the migrated modals use);
// `Input`/`Input.TextArea autoSize` → `@agenta/ui` `Input`/`AutosizeTextarea`;
// `Switch onChange` → `Switch onCheckedChange` (+ an `aria-label`, since the tooltip is no
// longer the accessible name); `Tooltip title` → Radix Tooltip; `Typography.Text` → span +
// semantic token classes.
//
// NO `AntdVsAgenta` pair here, deliberately: the right pane hosts `MarkdownEditor` /
// `CodeEditor` (lexical, not exported and not part of this chunk), so an antd replay could
// not hold them constant across the two halves. The migrated leaves have their own parity
// grids — `DrillIn/SkillUploadZone` here, plus the wave-1 `@agenta/ui` Input/Switch/Field
// grids. These stories are the inventory + state coverage.
const meta = {
    title: "@agenta/entity-ui/DrillIn/SkillFormView",
    component: SkillFormView,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Inline skill authoring: name / description / SKILL.md body, bundled files with an executable flag, and the two behaviour toggles.",
            },
        },
    },
} satisfies Meta<typeof SkillFormView>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const SKILL = {
    name: "release-notes",
    description: "Draft release notes from a changelog",
    body: "# Release notes\n\nSummarise the changelog in three bullets.",
    disable_model_invocation: true,
}

const SKILL_WITH_FILES = {
    ...SKILL,
    files: [
        {path: "scripts/collect.py", content: "print('hello')\n", executable: true},
        {path: "reference/style.md", content: "# Style\n"},
    ],
}

function Frame({value, disabled}: {value: Record<string, unknown>; disabled?: boolean}) {
    const [current, setCurrent] = useState(value)
    return (
        <div className="h-[560px] w-[860px] overflow-hidden rounded-lg border border-solid border-colorBorderSecondary p-3">
            <SkillFormView value={current} onChange={setCurrent} disabled={disabled} />
        </div>
    )
}

/** SKILL.md selected: the markdown body editor, plus the drop zone in the Files rail. */
export const Default: Story = {
    args: {value: SKILL, onChange: noop},
    render: () => <Frame value={SKILL} />,
}

/** Bundled files listed in the rail; each row carries a hover-only remove control. */
export const WithFiles: Story = {
    args: {value: SKILL_WITH_FILES, onChange: noop},
    render: () => <Frame value={SKILL_WITH_FILES} />,
}

/** Read-only (committed revision): no add/remove/drop affordances, every leaf disabled. */
export const Disabled: Story = {
    args: {value: SKILL_WITH_FILES, onChange: noop, disabled: true},
    render: () => <Frame value={SKILL_WITH_FILES} disabled />,
}
