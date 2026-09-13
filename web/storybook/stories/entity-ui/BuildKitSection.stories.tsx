import {useState} from "react"

import {Wrench} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Switch as AntSwitch, Typography} from "antd"

// Imported from source: agentTemplate internals are not re-exported from the DrillInView barrel.
import {
    describeBuildKitEmbed,
    describeBuildKitPlatformTool,
} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/buildKitDescriptors"
import {
    BuildKitSection,
    type BuildKitTool,
} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/BuildKitSection"
import type {ItemDescriptor} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/itemDescriptors"
import {ItemRow} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/ItemRow"

// BuildKitSection - the presentational half of `useBuildKit`, split out
// of the hook so the read-only playground overlay can be storied with plain props. Migration:
// antd `Switch` → `@agenta/ui` `Switch` (`onChange` → `onCheckedChange`), antd `Tag` →
// presentational `Tag` (Badge default), antd `Tooltip` → Radix `Tooltip` (+ `TooltipProvider`),
// antd `Typography.Text type="secondary"` → a span on `text-colorTextSecondary`.
//
// The antd half replays the pre-migration markup from
// `git show feat/storybook-data-seam:web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/useBuildKit.tsx`
// inside the same (already-migrated) plain-panel / `ItemRow` chrome.
const meta = {
    title: "@agenta/entity-ui/DrillIn/BuildKitSection",
    component: BuildKitSection,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The playground-only build-kit overlay: one readable tool list with switchable platform tools and locked Agenta-owned embeds. Stored sandbox permissions are not displayed or changed.",
            },
        },
    },
} satisfies Meta<typeof BuildKitSection>

export default meta
type Story = StoryObj<typeof meta>

// The antd half keeps the raw ops the rows used to show, so the columns compare as markup.
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

const CAPTION =
    "These playground-only tools and permissions help the assistant build and revise this agent. None of this is part of the published agent."
const DISABLED_NOTE = "The assistant can no longer create files, run code, or edit the agent here."

/** Pre-migration antd markup. */
const AntdBuildKitSection = ({
    enabled = true,
    disabled,
}: {
    enabled?: boolean
    disabled?: boolean
}) => (
    <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 text-xs font-medium">Playground build kit</span>
                <AntSwitch checked={enabled} disabled={disabled} />
            </div>
            <Typography.Text type="secondary" className="text-[11px] leading-snug">
                {CAPTION}
            </Typography.Text>
        </div>
        {!enabled ? (
            <div className="rounded border border-solid border-[var(--ant-color-info-border)] bg-[var(--ant-color-info-bg)] px-2.5 py-2 text-[11.5px] leading-snug text-[var(--ant-color-info-text)]">
                {DISABLED_NOTE}
            </div>
        ) : null}
        <div className="flex flex-col gap-1.5">
            <Typography.Text type="secondary" className="text-xs">
                Platform tools
            </Typography.Text>
            {PLATFORM_OPS.map((op) => (
                <ItemRow key={`platform-${op}`} descriptor={platformDescriptor(op)} locked />
            ))}
        </div>
    </div>
)

const BASE = {
    tools: TOOLS,
    onToggleTool: () => undefined,
    onSetAllTools: () => undefined,
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

/** An empty overlay: the kit is on but contributes no tools. */
export const NoTools: Story = {
    args: {
        enabled: true,
        onEnabledChange: () => undefined,
        tools: [],
        onToggleTool: () => undefined,
        onSetAllTools: () => undefined,
    },
    render: () => (
        <div className="max-w-[560px]">
            <BuildKitSection
                enabled
                onEnabledChange={() => undefined}
                tools={[]}
                onToggleTool={() => undefined}
                onSetAllTools={() => undefined}
            />
        </div>
    ),
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
        </div>
    ),
}
