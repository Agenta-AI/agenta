import {SkillUploadPanel} from "@agenta/skills-ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

// The upload drawer's body (artboards 1c/1e). The invalid and multi-skill recovery
// states are reached by dropping files — drop a folder without a SKILL.md (red panel)
// or one with several SKILL.mds (selectable recovery list) to see them here.
const meta = {
    title: "@agenta/skills-ui/SkillUploadPanel",
    component: SkillUploadPanel,
    parameters: {
        layout: "centered",
        docs: {
            description: {
                component:
                    "Full-drawer dropzone in the truly-empty state; errors render IN this " +
                    "view (never by jumping to the editor) with the same dropzone below as " +
                    "the retry target. One valid skill hands off via onSingleSkill; a " +
                    "multi-skill recovery imports via onImportMany.",
            },
        },
    },
} satisfies Meta<typeof SkillUploadPanel>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

export const EmptyDropzone: Story = {
    args: {onSingleSkill: noop, onImportMany: noop},
    render: (args) => (
        <div className="flex h-[480px] w-[520px] flex-col">
            <SkillUploadPanel {...args} />
        </div>
    ),
}
