import type {AgentRequirementItem} from "@agenta/entities/workflow"
import {ItemRow, NeedsSetupTag, needsSetupStatus} from "@agenta/entity-ui/drill-in"
import type {Meta, StoryObj} from "@storybook/nextjs"

/**
 * The "Needs setup" tag with its reason on a second line. Item rows carry the pair through
 * their status; the model section, secret attachments and the MCP connection field use the
 * tag on its own. Every reason the server returns is shown, so the copy reads in one place.
 */
const meta = {
    title: "@agenta/entity-ui/AgentTemplate/NeedsSetupTag",
    component: NeedsSetupTag,
    parameters: {layout: "padded"},
} satisfies Meta<typeof NeedsSetupTag>

export default meta
type Story = StoryObj<typeof NeedsSetupTag>

const REASONS = [
    "No account chosen",
    "Not found in this project",
    "Not shared with this project",
    "Turned off",
    "Sign-in expired",
    "No longer available",
]

export const EveryReason: Story = {
    render: () => (
        <div className="flex flex-col gap-4">
            {REASONS.map((reason) => (
                <NeedsSetupTag key={reason} reason={reason} />
            ))}
        </div>
    ),
}

/** Under the model picker the section title already carries the tag, so only the reason shows. */
export const ReasonOnly: Story = {
    args: {reason: "No longer available", tag: false},
}

const requirement = (reason: string): AgentRequirementItem => ({
    key: "mcp_sign_in:linear",
    kind: "mcp_sign_in",
    label: "Linear",
    reference: {slug: "linear"},
    paths: ["agent.mcps[0].connection"],
    reason,
    blocks_run: false,
})

const descriptor = (name: string) => ({
    name,
    monoName: false,
    mono: name.charAt(0),
    color: "var(--ag-colorPrimary)",
    tags: [],
    typeLabel: "mcp",
    subtitle: "MCP server",
    description: "https://mcp.linear.app/mcp",
})

/** An item card: the tag where the row's status sits, the reason in place of the description. */
export const OnItemRows: Story = {
    render: () => (
        <div className="flex max-w-[420px] flex-col gap-2">
            <ItemRow descriptor={descriptor("Linear")} onEdit={() => undefined} />
            <ItemRow
                descriptor={descriptor("Linear")}
                onEdit={() => undefined}
                status={needsSetupStatus(requirement("needs_sign_in"))}
            />
            <ItemRow
                descriptor={descriptor("GitHub")}
                onEdit={() => undefined}
                status={needsSetupStatus(requirement("not_found"))}
            />
            {/* A viewer who cannot fix it: no click target, the tag and reason only. */}
            <ItemRow
                descriptor={descriptor("Octolens")}
                disabled
                status={needsSetupStatus(requirement("turned_off"))}
            />
        </div>
    ),
}
