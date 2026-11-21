import {ApprovalCard} from "@agenta/chat/components"
import type {PendingApproval} from "@agenta/chat/model"
import type {Meta, StoryObj} from "@storybook/nextjs"

import type {AgentaDataParameters} from "../../../.storybook/decorators/withAgentaData"
import {
    ADD_MCP_SERVER,
    ADD_SKILL,
    CHANGE_MODEL,
    CHANGE_PERMISSION,
    conflictQueries,
    EDIT_INSTRUCTIONS,
    EDIT_INSTRUCTIONS_NO_PREVIEW,
    EDIT_SKILL_FILE,
    REMOVE_INTEGRATION,
    SEVERAL_CHANGES,
} from "../../../fixtures/builderLayout/card-data"

/**
 * The change cards of canvas C01 (task 25.1, 25.2): the header with the change's path, the four
 * detail forms, the warning lines, and the footer "Saves as v5" with Deny and Approve.
 */
const ChangeCardDemo = ({approval}: {approval: PendingApproval}) => (
    <div data-testid="change-card" className="w-[440px] bg-background p-4">
        <ApprovalCard
            approvals={[approval]}
            onRespond={() => undefined}
            onApproveAll={() => undefined}
        />
    </div>
)

const meta = {
    title: "BuilderLayout/card-data/Change cards",
    component: ChangeCardDemo,
    parameters: {layout: "centered"},
} satisfies Meta<typeof ChangeCardDemo>

export default meta
type Story = StoryObj<typeof meta>

export const EditInstructions: Story = {args: {approval: EDIT_INSTRUCTIONS}}
export const EditSkillFile: Story = {args: {approval: EDIT_SKILL_FILE}}
export const ChangeModel: Story = {args: {approval: CHANGE_MODEL}}
export const AddSkill: Story = {args: {approval: ADD_SKILL}}
export const AddMcpServer: Story = {args: {approval: ADD_MCP_SERVER}}
export const ChangePermission: Story = {args: {approval: CHANGE_PERMISSION}}
export const RemoveIntegration: Story = {args: {approval: REMOVE_INTEGRATION}}
export const NoPreview: Story = {args: {approval: EDIT_INSTRUCTIONS_NO_PREVIEW}}
export const SeveralChanges: Story = {args: {approval: SEVERAL_CHANGES}}

/** A newer version landed after the builder read v4: the conflict shows before a click. */
export const Conflict: Story = {
    args: {approval: CHANGE_MODEL},
    parameters: {
        agenta: {
            queries: (scope) => conflictQueries(scope.projectId),
        } satisfies AgentaDataParameters,
    },
}
