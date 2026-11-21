import {useState} from "react"

import type {LlmProvider} from "@agenta/shared/types"
import type {Meta, StoryObj} from "@storybook/nextjs"

// Imported from source: agentTemplate internals are not re-exported from the DrillInView barrel.
import {ProviderCredentialsSectionView} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/ProviderCredentialsSectionView"
import type {ConnectionMode} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/connectionUtils"

// ProviderCredentialsSectionView — the presentational half of the "Provider credentials" pane.
// The container (`ProviderCredentialsSection`) reads `standardSecretsAtom`/`customSecretsAtom`;
// this view takes them as props, which is what makes the pane storiable with plain data.
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

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[9rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div>{children}</div>
    </div>
)

export const Variants: Story = {
    args: {...BASE, mode: "self_managed", onModeChange: () => undefined},
    render: () => (
        <div className="flex max-w-[640px] flex-col">
            <Row label="self-managed (bare)">
                <ProviderCredentialsSectionView
                    {...BASE}
                    bare
                    mode="self_managed"
                    onModeChange={() => undefined}
                />
            </Row>
            <Row label="self-managed on cloud">
                <ProviderCredentialsSectionView
                    {...BASE}
                    bare
                    isCloud
                    mode="self_managed"
                    onModeChange={() => undefined}
                />
            </Row>
            <Row label="self-managed (disabled)">
                <ProviderCredentialsSectionView
                    {...BASE}
                    bare
                    disabled
                    mode="self_managed"
                    onModeChange={() => undefined}
                />
            </Row>
        </div>
    ),
}
