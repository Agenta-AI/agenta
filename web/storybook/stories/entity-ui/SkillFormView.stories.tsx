import {useState} from "react"

import {SkillFormView} from "@agenta/entity-ui/drill-in"
import type {Meta, StoryObj} from "@storybook/nextjs"

// SkillFormView — the folder-shaped inline-skill editor: a Files rail (SKILL.md pinned, the
// bundled files, the SkillUploadZone) beside the skill-level fields, the selected file's
// editor and the two behaviour toggles.
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

function Frame({
    value,
    disabled,
    downloadable,
}: {
    value: Record<string, unknown>
    disabled?: boolean
    downloadable?: boolean
}) {
    const [current, setCurrent] = useState(value)
    return (
        <div className="h-[560px] w-[860px] overflow-hidden rounded-lg border border-solid border-colorBorderSecondary p-3">
            <SkillFormView
                value={current}
                onChange={setCurrent}
                disabled={disabled}
                downloadable={downloadable}
            />
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

/** Saved skill: the rail header offers a download, as `<name>.zip` here since it bundles files. */
export const Downloadable: Story = {
    args: {value: SKILL_WITH_FILES, onChange: noop, downloadable: true},
    render: () => <Frame value={SKILL_WITH_FILES} downloadable />,
}

/** Read-only and downloadable: an archived or built-in skill can still be taken out. */
export const DownloadableReadOnly: Story = {
    args: {value: SKILL, onChange: noop, disabled: true, downloadable: true},
    render: () => <Frame value={SKILL} disabled downloadable />,
}
