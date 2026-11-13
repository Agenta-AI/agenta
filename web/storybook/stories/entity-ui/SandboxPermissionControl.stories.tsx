import {useState} from "react"

import type {Meta, StoryObj} from "@storybook/nextjs"

// Imported from source: the DrillInView barrel does not re-export this control.
import {SandboxPermissionControl} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/SandboxPermissionControl"

// SandboxPermissionControl — `sandbox.permissions` as `RailField` rows: network egress mode, a
// conditional CIDR allowlist, optional filesystem access, and enforcement.
const meta = {
    title: "@agenta/entity-ui/DrillIn/SandboxPermissionControl",
    component: SandboxPermissionControl,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The sandbox security boundary: network egress mode (+ CIDR allowlist when `allowlist`), optional filesystem access, enforcement.",
            },
        },
    },
} satisfies Meta<typeof SandboxPermissionControl>

export default meta
type Story = StoryObj<typeof meta>

const ALLOWLIST_VALUE = {
    network: {mode: "allowlist", allowlist: ["10.0.0.0/8", "192.168.0.0/16"]},
    filesystem: "readonly",
    enforcement: "strict",
}

/** The component is a fragment of RailField rows, so it needs a wrapper. */
const Frame = ({children}: {children: React.ReactNode}) => (
    <div className="flex flex-col gap-3">{children}</div>
)

const Live = ({initial, disabled}: {initial?: Record<string, unknown>; disabled?: boolean}) => {
    const [value, setValue] = useState<Record<string, unknown> | null>(initial ?? null)
    return (
        <div className="max-w-[520px]">
            <Frame>
                <SandboxPermissionControl value={value} onChange={setValue} disabled={disabled} />
            </Frame>
        </div>
    )
}

/** Unset — the SDK defaults (network on, enforcement strict), no allowlist row, no filesystem. */
export const Default: Story = {
    args: {value: null, onChange: () => undefined},
    render: () => <Live />,
}

/** `allowlist` mode reveals the conditional CIDR textarea. */
export const AllowlistMode: Story = {
    args: {value: ALLOWLIST_VALUE, onChange: () => undefined},
    render: () => <Live initial={ALLOWLIST_VALUE} />,
}

/** Read-only — every control takes the disabled skin. */
export const Disabled: Story = {
    args: {value: ALLOWLIST_VALUE, onChange: () => undefined, disabled: true},
    render: () => <Live initial={ALLOWLIST_VALUE} disabled />,
}

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[10rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div>{children}</div>
    </div>
)

export const Variants: Story = {
    args: {value: ALLOWLIST_VALUE, onChange: () => undefined},
    render: () => (
        <div className="flex max-w-[640px] flex-col">
            <Row label="allowlist mode">
                <Frame>
                    <SandboxPermissionControl value={ALLOWLIST_VALUE} onChange={() => undefined} />
                </Frame>
            </Row>
            <Row label="defaults (no allowlist)">
                <Frame>
                    <SandboxPermissionControl value={null} onChange={() => undefined} />
                </Frame>
            </Row>
            <Row label="disabled">
                <Frame>
                    <SandboxPermissionControl
                        value={ALLOWLIST_VALUE}
                        onChange={() => undefined}
                        disabled
                    />
                </Frame>
            </Row>
        </div>
    ),
}
