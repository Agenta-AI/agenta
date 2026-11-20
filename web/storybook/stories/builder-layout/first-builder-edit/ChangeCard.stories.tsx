import {ApprovalCard} from "@agenta/chat/components"
import type {PendingApproval} from "@agenta/chat/model"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {
    BUILDER_EDIT_NO_PREVIEW,
    BUILDER_EDIT_WITH_PREVIEW,
} from "../../../fixtures/builderLayout/first-builder-edit"

/**
 * The minimal change card of a builder edit (task 8.2): the old and new values of the server
 * preview, or the proposed values with a label when the call has no preview.
 */
const ChangeCardDemo = ({approval}: {approval: PendingApproval}) => (
    <div data-testid="change-card" className="w-[420px] bg-background p-4">
        <ApprovalCard
            approvals={[approval]}
            onRespond={() => undefined}
            onApproveAll={() => undefined}
        />
    </div>
)

const meta = {
    title: "BuilderLayout/first-builder-edit/Change card",
    component: ChangeCardDemo,
    parameters: {layout: "centered"},
} satisfies Meta<typeof ChangeCardDemo>

export default meta
type Story = StoryObj<typeof meta>

export const WithPreview: Story = {args: {approval: BUILDER_EDIT_WITH_PREVIEW}}
export const NoPreview: Story = {args: {approval: BUILDER_EDIT_NO_PREVIEW}}
