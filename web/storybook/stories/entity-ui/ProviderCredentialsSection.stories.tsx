import {useState} from "react"

import type {LlmProvider} from "@agenta/shared/types"
import {cn} from "@agenta/ui/styles"
import {Terminal} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Segmented as AntSegmented, Typography} from "antd"

// Imported from source: agentTemplate internals are not re-exported from the DrillInView barrel.
import {ProviderCredentialsSectionView} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/ProviderCredentialsSectionView"
import type {ConnectionMode} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/connectionUtils"

// ProviderCredentialsSectionView — the presentational half of the "Provider credentials" pane.
// The container (`ProviderCredentialsSection`) reads `standardSecretsAtom`/`customSecretsAtom`;
// this view takes them as props, which is what makes the pane storiable with plain data.
// Migration: antd `Segmented` → `@agenta/ui` `Segmented` (`size="small"` → `"sm"`, and the
// `.ant-segmented-*` class overrides become `[data-slot=segmented-*]`), antd `Typography.Text`
// → spans on semantic tokens.
//
// The antd half replays the pre-migration markup from
// `git show feat/storybook-data-seam:web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/ProviderCredentialsSection.tsx`.
const meta = {
    title: "@agenta/entity-ui/DrillIn/ProviderCredentialsSection",
    component: ProviderCredentialsSectionView,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "API key vs subscription toggle over a provider rail + key form (or the self-managed card). The rail is filtered to the selected model's provider family; 'Add …' rows open the host's Configure-provider drawer.",
            },
        },
    },
} satisfies Meta<typeof ProviderCredentialsSectionView>

export default meta
type Story = StoryObj<typeof meta>

const STANDARD_SECRETS: LlmProvider[] = [
    {name: "OPENAI_API_KEY", title: "OpenAI", key: "sk-live-redacted"},
    {name: "ANTHROPIC_API_KEY", title: "Anthropic", key: ""},
    {name: "MISTRAL_API_KEY", title: "Mistral AI", key: ""},
]

const CUSTOM_SECRETS: LlmProvider[] = [
    {
        id: "conn-1",
        name: "prod-bedrock",
        provider: "bedrock",
        models: ["anthropic.claude-3-5-sonnet", "anthropic.claude-3-haiku"],
    },
]

const MODE_OPTIONS: ConnectionMode[] = ["agenta", "self_managed"]

const BASE = {
    standardSecrets: STANDARD_SECRETS,
    customSecrets: CUSTOM_SECRETS,
    selectedProviderFamily: "openai" as string | null,
    modeOptions: MODE_OPTIONS,
    isCloud: false,
    openConfigureProvider: () => undefined,
}

/** The pre-migration segmented styling — the same override intent, antd class hooks. */
const antdSegmentedClassName = cn(
    "rounded-md border border-solid border-[var(--ag-colorBorder)] !bg-[var(--ag-colorFillTertiary)]",
    "[&_.ant-segmented-item-selected]:!bg-[var(--ag-colorText)] [&_.ant-segmented-item-selected]:!text-[var(--ag-colorBgContainer)] [&_.ant-segmented-item-selected]:!shadow-none",
    "[&_.ant-segmented-thumb]:!bg-[var(--ag-colorText)] [&_.ant-segmented-thumb]:!shadow-none",
)

const TOGGLE_OPTIONS = [
    {label: "API key", value: "agenta"},
    {label: "Subscription", value: "self_managed"},
]

/** Pre-migration antd markup: the mode toggle. */
const AntdModeToggle = ({
    mode = "agenta",
    disabled,
}: {
    mode?: ConnectionMode
    disabled?: boolean
}) => (
    <AntSegmented
        size="small"
        value={mode}
        disabled={disabled}
        options={TOGGLE_OPTIONS}
        className={antdSegmentedClassName}
    />
)

/** Pre-migration antd markup: the self-managed card. */
const AntdSelfManagedCard = ({isCloud}: {isCloud?: boolean}) => (
    <div className="flex flex-col items-start gap-3 rounded-[10px] border border-solid border-[var(--ag-colorBorderSecondary)] p-4">
        <div className="flex h-[38px] w-[38px] items-center justify-center rounded-[10px] border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorFillQuaternary)]">
            <Terminal size={18} className="text-[var(--ag-colorTextSecondary)]" />
        </div>
        <div className="flex flex-col gap-1">
            <Typography.Text className="!text-[14.5px] !font-semibold">
                Self-managed
            </Typography.Text>
            <ul className="m-0 flex list-disc flex-col gap-0.5 pl-4">
                <li>
                    <Typography.Text type="secondary" className="!text-xs !leading-relaxed">
                        Use a Claude Code or Codex subscription, or any credential the harness reads
                        from its own environment (env vars, prior logins).
                    </Typography.Text>
                </li>
                <li>
                    <Typography.Text type="secondary" className="!text-xs !leading-relaxed">
                        Agenta stores and injects no key.
                    </Typography.Text>
                </li>
                <li>
                    <Typography.Text
                        type="secondary"
                        className="!text-xs !font-semibold !leading-relaxed"
                    >
                        Requires a self-hosted Agenta deployment.
                    </Typography.Text>
                </li>
            </ul>
        </div>
        <div className="flex flex-wrap items-center gap-2">
            <a
                href="https://docs.agenta.ai/self-host/quick-start"
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-solid border-[var(--ag-colorBorder)] px-2.5 py-1 text-xs font-medium text-[var(--ag-colorText)] no-underline hover:bg-[var(--ag-colorFillTertiary)]"
            >
                Read the self-hosting guide →
            </a>
            {isCloud ? (
                <span className="rounded-full border border-solid border-[var(--ag-colorErrorBorder)] bg-[var(--ag-colorErrorBg,rgba(255,77,79,0.12))] px-2 py-0.5 text-[11px] text-[var(--ag-colorErrorText)]">
                    Unavailable in the cloud
                </span>
            ) : null}
        </div>
    </div>
)

/** Pre-migration antd markup: the whole `bare` self-managed variant (header toggle + card). */
const AntdBareSelfManaged = ({isCloud, disabled}: {isCloud?: boolean; disabled?: boolean}) => (
    <div className="flex min-w-0 flex-col gap-3">
        <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1" />
            <AntdModeToggle mode="self_managed" disabled={disabled} />
        </div>
        <AntdSelfManagedCard isCloud={isCloud} />
    </div>
)

const Live = ({
    initialMode = "agenta",
    ...rest
}: {initialMode?: ConnectionMode} & Partial<
    React.ComponentProps<typeof ProviderCredentialsSectionView>
>) => {
    const [mode, setMode] = useState<ConnectionMode>(initialMode)
    return (
        <div className="max-w-[720px]">
            <ProviderCredentialsSectionView
                {...BASE}
                {...rest}
                mode={mode}
                onModeChange={setMode}
            />
        </div>
    )
}

/** The full section: header toggle over the provider rail + the selected provider's key form. */
export const Default: Story = {
    args: {...BASE, mode: "agenta", onModeChange: () => undefined},
    render: () => <Live />,
}

/** The selected provider has a vault slot but no key — header warns, badge says "Connect key". */
export const NeedsKey: Story = {
    args: {
        ...BASE,
        mode: "agenta",
        onModeChange: () => undefined,
        selectedProviderFamily: "anthropic",
        providerNeedsKey: true,
    },
    render: () => <Live selectedProviderFamily="anthropic" providerNeedsKey />,
}

/** Subscription mode — the self-managed explainer replaces the rail. */
export const SelfManaged: Story = {
    args: {...BASE, mode: "self_managed", onModeChange: () => undefined},
    render: () => <Live initialMode="self_managed" />,
}

/** Cloud deployment: the card carries the "Unavailable in the cloud" badge. */
export const SelfManagedOnCloud: Story = {
    args: {...BASE, mode: "self_managed", onModeChange: () => undefined, isCloud: true},
    render: () => <Live initialMode="self_managed" isCloud />,
}

/** A named vault connection is selected — read-only summary, its key lives in Settings → Secrets. */
export const CustomConnection: Story = {
    args: {
        ...BASE,
        mode: "agenta",
        onModeChange: () => undefined,
        selectedProviderFamily: null,
        selectedConnectionSlug: "prod-bedrock",
    },
    render: () => <Live selectedProviderFamily={null} selectedConnectionSlug="prod-bedrock" />,
}

/** Compact inline variant used under the section header (no accordion chrome, top rail). */
export const Bare: Story = {
    args: {...BASE, mode: "agenta", onModeChange: () => undefined, bare: true},
    render: () => <Live bare />,
}

/** Read-only surface — toggle, rail rows and key form all take the disabled skin. */
export const Disabled: Story = {
    args: {...BASE, mode: "agenta", onModeChange: () => undefined, disabled: true},
    render: () => <Live disabled />,
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
            <div className="w-[380px]" data-vrt-subject>
                {a}
            </div>
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div className="w-[380px]" data-vrt-subject>
                {s}
            </div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    args: {...BASE, mode: "self_managed", onModeChange: () => undefined},
    render: () => (
        <div className="flex max-w-[1050px] flex-col">
            {/* The `bare` self-managed variant is the one branch that can be replayed whole in
                antd (header toggle + explainer card), so it is what carries the Segmented and
                Typography swaps. The rail/key-form branch is covered by ProviderKeyField. */}
            <Row
                label="self-managed (bare)"
                a={<AntdBareSelfManaged />}
                s={
                    <ProviderCredentialsSectionView
                        {...BASE}
                        bare
                        mode="self_managed"
                        onModeChange={() => undefined}
                    />
                }
            />
            <Row
                label="self-managed on cloud"
                a={<AntdBareSelfManaged isCloud />}
                s={
                    <ProviderCredentialsSectionView
                        {...BASE}
                        bare
                        isCloud
                        mode="self_managed"
                        onModeChange={() => undefined}
                    />
                }
            />
            <Row
                label="self-managed (disabled)"
                a={<AntdBareSelfManaged disabled />}
                s={
                    <ProviderCredentialsSectionView
                        {...BASE}
                        bare
                        disabled
                        mode="self_managed"
                        onModeChange={() => undefined}
                    />
                }
            />
        </div>
    ),
}
