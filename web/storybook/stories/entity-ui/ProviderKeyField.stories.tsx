import type {LlmProvider} from "@agenta/shared/types"
import type {Meta, StoryObj} from "@storybook/nextjs"

// Imported from source: agentTemplate internals are not re-exported from the DrillInView barrel.
import ProviderKeyField from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/ProviderKeyField"

// ProviderKeyField — the right-pane "API key" form of the Provider credentials section: heading +
// subtitle, a masked key input, Save/Replace, and the encryption footnote. Saves go straight to
// the project vault (`useVaultSecret`), so this stays a small container; everything it renders is
// props-driven.
const meta = {
    title: "@agenta/entity-ui/DrillIn/ProviderKeyField",
    component: ProviderKeyField,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Immediate-save API-key form for a standard provider: masked key input, Save or Replace button, and an encryption note. The label is a real `<label htmlFor>` so the field has an accessible name.",
            },
        },
    },
} satisfies Meta<typeof ProviderKeyField>

export default meta
type Story = StoryObj<typeof meta>

const OPENAI: LlmProvider = {name: "OPENAI_API_KEY", title: "OpenAI", key: ""}
const OPENAI_CONFIGURED: LlmProvider = {...OPENAI, key: "sk-live-redacted"}

/** No key yet — Save is disabled until something is typed. */
export const Default: Story = {
    args: {provider: OPENAI},
    render: () => (
        <div className="max-w-[420px]">
            <ProviderKeyField provider={OPENAI} />
        </div>
    ),
}

/** A key already exists: the "configured" line shows and the button reads Replace. */
export const Configured: Story = {
    args: {provider: OPENAI_CONFIGURED},
    render: () => (
        <div className="max-w-[420px]">
            <ProviderKeyField provider={OPENAI_CONFIGURED} />
        </div>
    ),
}

/** `hideHeader` — the compact variant used where a selected rail chip already names the provider. */
export const HideHeader: Story = {
    args: {provider: OPENAI_CONFIGURED, hideHeader: true},
    render: () => (
        <div className="max-w-[420px]">
            <ProviderKeyField provider={OPENAI_CONFIGURED} hideHeader />
        </div>
    ),
}

/** Read-only surface — input and button both take the disabled skin. */
export const Disabled: Story = {
    args: {provider: OPENAI_CONFIGURED, disabled: true},
    render: () => (
        <div className="max-w-[420px]">
            <ProviderKeyField provider={OPENAI_CONFIGURED} disabled />
        </div>
    ),
}

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[9rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div>{children}</div>
    </div>
)

export const Variants: Story = {
    args: {provider: OPENAI},
    render: () => (
        <div className="flex max-w-[640px] flex-col">
            <Row label="no key yet">
                <ProviderKeyField provider={OPENAI} />
            </Row>
            <Row label="configured">
                <ProviderKeyField provider={OPENAI_CONFIGURED} />
            </Row>
            <Row label="hideHeader">
                <ProviderKeyField provider={OPENAI_CONFIGURED} hideHeader />
            </Row>
            <Row label="disabled">
                <ProviderKeyField provider={OPENAI_CONFIGURED} disabled />
            </Row>
        </div>
    ),
}
