import {useState} from "react"

import type {SchemaProperty} from "@agenta/entities/shared"
import {SchemaPropertyRenderer} from "@agenta/entity-ui/drill-in"
import type {Meta, StoryObj} from "@storybook/nextjs"

const permissions = {
    type: "object",
    properties: {default: {type: "string", enum: ["allow", "allow_reads", "ask", "deny"]}},
}
const schema = (environments: string[]): SchemaProperty => ({
    type: "object",
    "x-ag-type": "agent-template",
    properties: {
        runner: {type: "object", properties: {permissions}},
        sandbox: {
            type: "object",
            properties: {
                kind: {type: "string", enum: environments},
                permissions: {type: "object"},
            },
        },
    },
})

const saved = {
    harness: {
        kind: "claude",
        permissions: {allow: ["Read"], deny: ["Write"], default_mode: "plan"},
    },
    runner: {permissions: {default: "ask", rules: [{tool: "restricted", policy: "deny"}]}},
    sandbox: {kind: "local", permissions: {network: "off", filesystem: "readonly"}},
}

function Settings({
    disabled = false,
    environments = ["local"],
}: {
    disabled?: boolean
    environments?: string[]
}) {
    const [value, setValue] = useState<Record<string, unknown>>(saved)
    return (
        <div className="flex w-full max-w-[560px] flex-col gap-4">
            <SchemaPropertyRenderer
                label="Agent"
                schema={schema(environments)}
                value={value}
                onChange={(next) => setValue(next as Record<string, unknown>)}
                disabled={disabled}
            />
            <details>
                <summary>Stored configuration (hidden restrictions are preserved)</summary>
                <pre className="overflow-auto text-xs">{JSON.stringify(value, null, 2)}</pre>
            </details>
        </div>
    )
}

const meta = {
    title: "@agenta/entity-ui/DrillIn/AgentSharedSettings",
    component: Settings,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Shared permissions outside Advanced. Environment choices are intersected with deployment-enabled providers. The stored configuration exposes preserved restrictions for inspection, not editing.",
            },
        },
    },
} satisfies Meta<typeof Settings>
export default meta
type Story = StoryObj<typeof meta>

export const SavedRestrictions: Story = {}
export const ReadOnly: Story = {args: {disabled: true}}
export const NoSchemaEnvironments: Story = {args: {environments: []}}
export const DeploymentEnvironments: Story = {
    args: {environments: ["local", "daytona"]},
    parameters: {
        docs: {
            description: {
                story: "Enable both local and daytona in NEXT_PUBLIC_AGENTA_ENABLED_SANDBOX_PROVIDERS to exercise the Advanced environment selector. With only local enabled, Advanced stays hidden.",
            },
        },
    },
}
export const NarrowPanel: Story = {
    decorators: [
        (Story) => (
            <div className="w-[320px] max-w-full">
                <Story />
            </div>
        ),
    ],
}
