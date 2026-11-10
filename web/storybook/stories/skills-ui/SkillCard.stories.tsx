import {SkillCard, type SkillListItem} from "@agenta/skills-ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

// One registry card: the skill mark, the readable title, the description and the meta line.
const meta = {
    title: "@agenta/skills-ui/SkillCard",
    component: SkillCard,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A registry card. Every skill shows the same mark; the title is the SKILL.md " +
                    "name made readable, never the workflow slug with its random suffix.",
            },
        },
    },
    decorators: [
        (Story) => (
            <div className="grid max-w-[640px] grid-cols-2 gap-3">
                <Story />
            </div>
        ),
    ],
} satisfies Meta<typeof SkillCard>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const PROJECT: SkillListItem = {
    id: "s1",
    slug: "laptop-replacement-policy",
    name: "laptop-replacement-policy-3f2a",
    description: "When and how an employee gets a new laptop, and who approves it.",
    origin: "project",
    version: "2",
    filesCount: 2,
    usedByCount: 3,
    age: "2d ago",
}

const BUILTIN: SkillListItem = {
    id: "__ag__web-search",
    slug: "web-search",
    name: "web-search",
    description: "Search the web and cite sources.",
    origin: "builtin",
}

export const ProjectSkill: Story = {args: {skill: PROJECT, onOpen: noop}}

export const BuiltInSkill: Story = {args: {skill: BUILTIN, onOpen: noop}}

export const Archived: Story = {
    args: {skill: {...PROJECT, id: "s2", archived: true}, onOpen: noop},
}
