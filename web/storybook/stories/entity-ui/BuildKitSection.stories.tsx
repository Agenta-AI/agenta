import {useState} from "react"

import type {BuildKitUiState} from "@agenta/entities/workflow"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {
    describeBuildKitEmbed,
    describeBuildKitPlatformTool,
} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/buildKitDescriptors"
import {
    BuildKitSection,
    type BuildKitTool,
} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/BuildKitSection"

const tools: BuildKitTool[] = [
    ...[
        "create_schedule",
        "remove_schedule",
        "apply_skill_update",
        "discover_triggers",
        "list_schedules",
    ].map((op) => ({
        key: op,
        op,
        readOnly: op === "discover_triggers" || op === "list_schedules",
        descriptor: describeBuildKitPlatformTool(op),
    })),
    ...[
        "__ag__request_connection",
        "__ag__request_input",
        "__ag__request_secret",
        "__ag__build_an_agent",
    ].map((slug) => ({key: slug, descriptor: describeBuildKitEmbed(slug, undefined)})),
]
const meta = {
    title: "@agenta/entity-ui/DrillIn/BuildKitSection",
    component: BuildKitSection,
    parameters: {layout: "padded"},
    args: {state: {enabled: true, disabledOps: []}, tools, onChange: () => undefined},
} satisfies Meta<typeof BuildKitSection>
export default meta
type Story = StoryObj<typeof meta>

function Interactive({initial}: {initial: BuildKitUiState}) {
    const [state, onChange] = useState(initial)
    return (
        <div className="max-w-[680px]">
            <BuildKitSection state={state} onChange={onChange} tools={tools} />
        </div>
    )
}
export const AllowAll: Story = {
    render: () => <Interactive initial={{enabled: true, disabledOps: []}} />,
}
export const AllowReads: Story = {
    render: () => (
        <Interactive initial={{enabled: true, disabledOps: [], permissionDefault: "allow_reads"}} />
    ),
}
export const AskAll: Story = {
    render: () => (
        <Interactive initial={{enabled: true, disabledOps: [], permissionDefault: "ask"}} />
    ),
}
export const Custom: Story = {
    render: () => (
        <Interactive
            initial={{
                enabled: true,
                disabledOps: ["remove_schedule"],
                permissionOverrides: {create_schedule: "ask"},
            }}
        />
    ),
}
export const Deactivated: Story = {
    render: () => <Interactive initial={{enabled: false, disabledOps: []}} />,
}
export const ReadOnly: Story = {args: {disabled: true}}
export const Empty: Story = {args: {tools: []}}
export const LegacyMigration: Story = {
    render: () => <Interactive initial={{enabled: true, disabledOps: ["remove_schedule"]}} />,
}
