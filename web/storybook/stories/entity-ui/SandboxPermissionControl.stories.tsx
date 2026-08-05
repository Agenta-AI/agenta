import {useState} from "react"

import {RailField, railInfoLabel} from "@agenta/entity-ui/drawers/shared"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Input as AntInput, Select as AntSelect} from "antd"

// Imported from source: the DrillInView barrel does not re-export this control.
import {SandboxPermissionControl} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/SandboxPermissionControl"

// SandboxPermissionControl — `sandbox.permissions` as `RailField` rows: network egress mode, a
// conditional CIDR allowlist, optional filesystem access, and enforcement. Migration:
// antd `Select` → `@agenta/ui` `Select` (network / enforcement — not clearable), antd
// `Select allowClear` → `Combobox` (filesystem), antd `Input.TextArea autoSize` →
// `AutosizeTextarea`.
//
// The antd half replays the pre-migration markup from
// `git show feat/storybook-data-seam:web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/SandboxPermissionControl.tsx`
// inside the same (already-migrated) `RailField` chrome.
const meta = {
    title: "@agenta/entity-ui/DrillIn/SandboxPermissionControl",
    component: SandboxPermissionControl,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The sandbox security boundary: network egress mode (+ CIDR allowlist when `allowlist`), optional filesystem access, enforcement. antd `Select` → `Select`/`Combobox`; antd `Input.TextArea autoSize` → `AutosizeTextarea`.",
            },
        },
    },
} satisfies Meta<typeof SandboxPermissionControl>

export default meta
type Story = StoryObj<typeof meta>

const NETWORK_MODE_OPTIONS = [
    {value: "on", label: "Allow all egress"},
    {value: "off", label: "Block all egress"},
    {value: "allowlist", label: "Allowlist (CIDR ranges)"},
]
const FILESYSTEM_OPTIONS = [
    {value: "on", label: "Read / write"},
    {value: "readonly", label: "Read-only"},
    {value: "off", label: "No access"},
]
const ENFORCEMENT_OPTIONS = [
    {value: "strict", label: "Strict (fail if unenforceable)"},
    {value: "best_effort", label: "Best effort"},
]

const NETWORK_EGRESS_HINT =
    "Outbound network access for the sandbox. Declared config; enforced by the runner."
const ALLOWLIST_HINT = "CIDR ranges allowed for outbound egress, one per line (e.g. 10.0.0.0/8)."
const FILESYSTEM_HINT =
    "Declared filesystem access for the sandbox. Optional; leave unset for no declared boundary."
const ENFORCEMENT_HINT =
    "Strict fails the run when the boundary can't be applied; best effort continues."

const ALLOWLIST_VALUE = {
    network: {mode: "allowlist", allowlist: ["10.0.0.0/8", "192.168.0.0/16"]},
    filesystem: "readonly",
    enforcement: "strict",
}

/** Both halves sit in the same wrapper — the component is a fragment of RailField rows. */
const Frame = ({children}: {children: React.ReactNode}) => (
    <div className="flex flex-col gap-3">{children}</div>
)

/** Pre-migration antd markup. */
const AntdSandboxPermissions = ({
    networkMode = "allowlist",
    allowlist = ["10.0.0.0/8", "192.168.0.0/16"],
    filesystem,
    enforcement = "strict",
    disabled,
}: {
    networkMode?: string
    allowlist?: string[]
    filesystem?: string
    enforcement?: string
    disabled?: boolean
}) => (
    <Frame>
        <RailField label={railInfoLabel("Network egress", NETWORK_EGRESS_HINT)} align="center">
            <AntSelect
                value={networkMode}
                options={NETWORK_MODE_OPTIONS}
                disabled={disabled}
                className="w-full"
            />
        </RailField>
        {networkMode === "allowlist" ? (
            <RailField label={railInfoLabel("Allowlist", ALLOWLIST_HINT)}>
                <AntInput.TextArea
                    value={allowlist.join("\n")}
                    placeholder={"10.0.0.0/8\n192.168.0.0/16"}
                    autoSize={{minRows: 2, maxRows: 6}}
                    disabled={disabled}
                    className="font-mono"
                />
            </RailField>
        ) : null}
        <RailField label={railInfoLabel("Filesystem", FILESYSTEM_HINT)} align="center">
            <AntSelect
                value={filesystem}
                options={FILESYSTEM_OPTIONS}
                placeholder="Not declared"
                allowClear
                disabled={disabled}
                className="w-full"
            />
        </RailField>
        <RailField label={railInfoLabel("Enforcement", ENFORCEMENT_HINT)} align="center">
            <AntSelect
                value={enforcement}
                options={ENFORCEMENT_OPTIONS}
                disabled={disabled}
                className="w-full"
            />
        </RailField>
    </Frame>
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

const Row = ({
    label,
    a,
    s,
    expected,
}: {
    label: string
    a: React.ReactNode
    s: React.ReactNode
    expected?: string
}) => (
    <div
        className="grid grid-cols-[10rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3"
        data-vrt-expected={expected}
    >
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            <div className="w-[420px]" data-vrt-subject>
                {a}
            </div>
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div className="w-[420px]" data-vrt-subject>
                {s}
            </div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    args: {value: ALLOWLIST_VALUE, onChange: () => undefined},
    render: () => (
        <div className="flex max-w-[1050px] flex-col">
            <Row
                label="allowlist mode"
                expected="filesystem row: antd Select allowClear → Combobox (typable trigger) — the only allowClear-capable primitive; the closed trigger reuses selectTriggerVariants, so it is dimensionally identical"
                a={<AntdSandboxPermissions filesystem="readonly" />}
                s={
                    <Frame>
                        <SandboxPermissionControl
                            value={ALLOWLIST_VALUE}
                            onChange={() => undefined}
                        />
                    </Frame>
                }
            />
            <Row
                label="defaults (no allowlist)"
                a={<AntdSandboxPermissions networkMode="on" />}
                s={
                    <Frame>
                        <SandboxPermissionControl value={null} onChange={() => undefined} />
                    </Frame>
                }
            />
            <Row
                label="disabled"
                a={<AntdSandboxPermissions filesystem="readonly" disabled />}
                s={
                    <Frame>
                        <SandboxPermissionControl
                            value={ALLOWLIST_VALUE}
                            onChange={() => undefined}
                            disabled
                        />
                    </Frame>
                }
            />
        </div>
    ),
}
