import {SkillDetailDrawer, skillRevisionsQueryKey, type SkillListItem} from "@agenta/skills-ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

import type {AgentaDataParameters} from "../../.storybook/decorators/withAgentaData"

// The skill drawer: its header shows the skill mark and the readable title.
const meta = {
    title: "@agenta/skills-ui/SkillDetailDrawer",
    component: SkillDetailDrawer,
    parameters: {layout: "fullscreen"},
} satisfies Meta<typeof SkillDetailDrawer>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const BUILTIN: SkillListItem = {
    id: "__ag__web-search",
    slug: "web-search",
    name: "web-search",
    description: "Search the web and cite sources.",
    origin: "builtin",
}

/** A built-in skill: no queries, the read-only preview. */
export const BuiltInSkill: Story = {
    args: {open: true, onClose: noop, projectId: "storybook-project", skill: BUILTIN},
}

// The usage query key, restated: `skillUsageQueryKey` is not exported from the package root.
const usageKey = (projectId: string, workflowId: string) =>
    ["skills", "usage", projectId, workflowId] as const

const projectSkill: AgentaDataParameters = {
    args: (scope) => ({
        projectId: scope.projectId,
        skill: {
            id: scope.id("skill"),
            slug: "laptop-replacement-policy",
            name: "laptop-replacement-policy",
            description: "When and how an employee gets a new laptop, and who approves it.",
            origin: "project",
            version: "2",
        } satisfies SkillListItem,
    }),
    queries: (scope) => [
        [
            skillRevisionsQueryKey(scope.projectId, scope.id("skill")),
            [
                {
                    id: scope.id("rev-2"),
                    version: "2",
                    skill: {
                        name: "laptop-replacement-policy",
                        description:
                            "When and how an employee gets a new laptop, and who approves it.",
                        body: "# Laptop replacement policy\n\nA laptop is replaced every three years.",
                        files: [],
                    },
                },
            ],
        ],
        [usageKey(scope.projectId, scope.id("skill")), {count: 0, referenced_by: []}],
    ],
}

/** A project skill, with its head revision seeded. */
export const ProjectSkill: Story = {
    args: {open: true, onClose: noop, projectId: "", skill: null},
    parameters: {agenta: projectSkill},
}
