import {useState} from "react"

import {RailField} from "@agenta/entity-ui/drawers/shared"
import {ConfigAccordionSection} from "@agenta/ui/components/presentational"
import {Warning, Wrench} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Switch as AntSwitch, Tag as AntTag, Tooltip as AntTooltip, Typography} from "antd"

// Imported from source: agentTemplate internals are not re-exported from the DrillInView barrel.
import {
    describeBuildKitEmbed,
    describeBuildKitPlatformTool,
} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/buildKitDescriptors"
import {
    BuildKitSection,
    type BuildKitTool,
    PermissionOverrideHint,
    formatPermissionValue,
} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/BuildKitSection"
import type {ItemDescriptor} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/itemDescriptors"
import {ItemRow} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/ItemRow"

// BuildKitSection / PermissionOverrideHint — the presentational half of `useBuildKit`, split out
// of the hook so the read-only playground overlay can be storied with plain props. Migration:
// antd `Switch` → `@agenta/ui` `Switch` (`onChange` → `onCheckedChange`), antd `Tag` →
// presentational `Tag` (Badge default), antd `Tooltip` → Radix `Tooltip` (+ `TooltipProvider`),
// antd `Typography.Text type="secondary"` → a span on `text-colorTextSecondary`.
//
// The antd half replays the pre-migration markup from
// `git show feat/storybook-data-seam:web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/useBuildKit.tsx`
// inside the same (already-migrated) `ConfigAccordionSection` / `RailField` / `ItemRow` chrome.
const meta = {
    title: "@agenta/entity-ui/DrillIn/BuildKitSection",
    component: BuildKitSection,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The playground-only build-kit overlay — one readable tool list (switchable platform tools plus the locked Agenta-owned embeds) and the sandbox permissions, under its enable switch. Stripped by the backend on commit. `PermissionOverrideHint` is the sibling warning shown above SandboxPermissionControl.",
            },
        },
    },
} satisfies Meta<typeof BuildKitSection>

export default meta
type Story = StoryObj<typeof meta>

// The pre-migration antd half renders the raw ops the rows used to show, so the two columns are
// comparable as MARKUP; the agenta half runs them through the copy table (#6025).
const platformDescriptor = (name: string): ItemDescriptor => ({
    name,
    description: "Platform-owned playground tool",
    mono: "",
    color: "#0d9488",
    icon: <Wrench size={15} weight="fill" />,
    tags: ["platform"],
    typeLabel: "platform",
    typeColor: "cyan",
    subtitle: "Platform tool",
})

const PLATFORM_OPS = ["discover_tools", "commit_revision", "query_spans", "test_run"]

// The locked Agenta-owned embeds, keyed by the slugs the copy table knows.
const EMBED_SLUGS = ["__ag__request_connection", "__ag__build_an_agent"]

const buildKitTools = (disabledOps: string[] = []): BuildKitTool[] => [
    ...PLATFORM_OPS.map((op) => ({
        key: op,
        descriptor: describeBuildKitPlatformTool(op),
        toggle: {op, enabled: !disabledOps.includes(op)},
    })),
    ...EMBED_SLUGS.map((slug) => ({
        key: slug,
        descriptor: describeBuildKitEmbed(slug, undefined),
    })),
]

const TOOLS = buildKitTools()

const PERMISSIONS: Record<string, unknown> = {
    network: "on",
    filesystem: "read_write",
    enforcement: {mode: "best_effort"},
}

const CAPTION =
    "These playground-only tools and permissions help the assistant build and revise this agent. None of this is part of the published agent."
const DISABLED_NOTE = "The assistant can no longer create files, run code, or edit the agent here."
const OVERRIDE_KEYS = ["network", "filesystem"]

/** Pre-migration antd markup. */
const AntdBuildKitSection = ({
    enabled = true,
    disabled,
}: {
    enabled?: boolean
    disabled?: boolean
}) => (
    <ConfigAccordionSection
        size="compact"
        defaultOpen
        icon={<Wrench size={15} />}
        title="Playground build kit"
        summary={
            <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--ag-colorWarning)]" />
                Removed on commit
            </span>
        }
        extra={<AntSwitch checked={enabled} disabled={disabled} />}
    >
        <Typography.Text type="secondary" className="text-[11px] leading-snug">
            {CAPTION}
        </Typography.Text>
        {!enabled ? (
            <div className="rounded border border-solid border-[var(--ant-color-info-border)] bg-[var(--ant-color-info-bg)] px-2.5 py-2 text-[11.5px] leading-snug text-[var(--ant-color-info-text)]">
                {DISABLED_NOTE}
            </div>
        ) : null}
        <RailField label="Platform tools">
            {PLATFORM_OPS.map((op) => (
                <ItemRow key={`platform-${op}`} descriptor={platformDescriptor(op)} locked />
            ))}
        </RailField>
        <RailField label="Sandbox permissions">
            <div className="flex flex-col gap-1.5 opacity-70">
                {Object.entries(PERMISSIONS).map(([key, value]) => (
                    <div
                        key={key}
                        className="flex items-center justify-between gap-3 rounded border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ant-color-fill-quaternary)] px-3 py-2 text-xs"
                    >
                        <span className="font-mono">{key}</span>
                        <AntTag className="m-0 font-mono text-[11px]">
                            {formatPermissionValue(value)}
                        </AntTag>
                    </div>
                ))}
            </div>
        </RailField>
    </ConfigAccordionSection>
)

/** Pre-migration antd markup for the override hint. */
const AntdPermissionOverrideHint = () => (
    <AntTooltip title="This value is overridden by the build kit in playground. Turn the build kit off to match the published agent.">
        <div className="inline-flex w-fit items-center gap-1.5 rounded bg-[var(--ant-color-warning-bg)] px-2 py-1 text-[11px] text-[var(--ant-color-warning-text)]">
            <Warning size={12} />
            Build kit overrides {OVERRIDE_KEYS.join(", ")}
        </div>
    </AntTooltip>
)

const BASE = {
    tools: TOOLS,
    onToggleTool: () => undefined,
    onSetAllTools: () => undefined,
    permissions: PERMISSIONS,
    // The app renders this collapsed; every story opens it so the body is visible/measured.
    defaultOpen: true,
}

const Live = ({
    initial = true,
    disabled,
    initialDisabledOps = [],
}: {
    initial?: boolean
    disabled?: boolean
    initialDisabledOps?: string[]
}) => {
    const [enabled, setEnabled] = useState(initial)
    const [disabledOps, setDisabledOps] = useState(initialDisabledOps)
    return (
        <div className="max-w-[560px]">
            <BuildKitSection
                {...BASE}
                enabled={enabled}
                onEnabledChange={setEnabled}
                disabled={disabled}
                tools={buildKitTools(disabledOps)}
                onToggleTool={(op, next) =>
                    setDisabledOps((prev) =>
                        next ? prev.filter((entry) => entry !== op) : [...prev, op],
                    )
                }
                onSetAllTools={(next) => setDisabledOps(next ? [] : PLATFORM_OPS)}
            />
        </div>
    )
}

/** Enabled — the assistant may create files, run code and edit the agent. */
export const Default: Story = {
    args: {...BASE, enabled: true, onEnabledChange: () => undefined},
    render: () => <Live />,
}

/** Disabled build kit — the info note explains what the assistant loses. */
export const KitOff: Story = {
    args: {...BASE, enabled: false, onEnabledChange: () => undefined},
    render: () => <Live initial={false} />,
}

/** Read-only surface — the enable switch takes the disabled skin. */
export const Disabled: Story = {
    args: {...BASE, enabled: true, onEnabledChange: () => undefined, disabled: true},
    render: () => <Live disabled />,
}

/** Some platform tools switched off individually (#6026) — the rail counts and dims accordingly. */
export const SomeToolsOff: Story = {
    args: {
        ...BASE,
        enabled: true,
        onEnabledChange: () => undefined,
        tools: buildKitTools(["commit_revision", "test_run"]),
    },
    render: () => <Live initialDisabledOps={["commit_revision", "test_run"]} />,
}

/** A thin overlay: permissions only, no tools. */
export const PermissionsOnly: Story = {
    args: {
        enabled: true,
        onEnabledChange: () => undefined,
        tools: [],
        onToggleTool: () => undefined,
        onSetAllTools: () => undefined,
        permissions: PERMISSIONS,
        defaultOpen: true,
    },
    render: () => (
        <div className="max-w-[560px]">
            <BuildKitSection
                enabled
                defaultOpen
                onEnabledChange={() => undefined}
                tools={[]}
                onToggleTool={() => undefined}
                onSetAllTools={() => undefined}
                permissions={PERMISSIONS}
            />
        </div>
    ),
}

/** The sibling hint rendered above SandboxPermissionControl. */
export const OverrideHint: Story = {
    args: {...BASE, enabled: true, onEnabledChange: () => undefined},
    render: () => <PermissionOverrideHint keys={OVERRIDE_KEYS} />,
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
        className="grid grid-cols-[9rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3"
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
    args: {...BASE, enabled: true, onEnabledChange: () => undefined},
    render: () => (
        <div className="flex max-w-[1050px] flex-col">
            <Row
                label="enabled"
                a={<AntdBuildKitSection />}
                s={<BuildKitSection {...BASE} enabled onEnabledChange={() => undefined} />}
            />
            <Row
                label="kit off"
                a={<AntdBuildKitSection enabled={false} />}
                s={<BuildKitSection {...BASE} enabled={false} onEnabledChange={() => undefined} />}
            />
            <Row
                label="override hint"
                a={<AntdPermissionOverrideHint />}
                s={<PermissionOverrideHint keys={OVERRIDE_KEYS} />}
            />
        </div>
    ),
}
