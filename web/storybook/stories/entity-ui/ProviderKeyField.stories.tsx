import type {LlmProvider} from "@agenta/shared/types"
import {CheckCircle} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Button as AntButton, Input as AntInput, Typography} from "antd"

// Imported from source: agentTemplate internals are not re-exported from the DrillInView barrel.
import ProviderKeyField from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/ProviderKeyField"

// ProviderKeyField — the right-pane "API key" form of the Provider credentials section: heading +
// subtitle, a masked key input, Save/Replace, and the encryption footnote. Saves go straight to
// the project vault (`useVaultSecret`), so this stays a small container; everything it renders is
// props-driven. Migration: antd `Input.Password` → `PasswordInput`, antd `Button loading` →
// `LoadingButton` (loading is not a Button prop), antd `App.useApp().message` →
// `@agenta/ui/app-message`, antd `Typography.Text` → spans on semantic tokens.
//
// The antd half replays the pre-migration markup from
// `git show feat/storybook-data-seam:web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/ProviderKeyField.tsx`.
const meta = {
    title: "@agenta/entity-ui/DrillIn/ProviderKeyField",
    component: ProviderKeyField,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Immediate-save API-key form for a standard provider. `Input.Password` → `PasswordInput`; `onPressEnter` → `onKeyDown`; antd's `InputRef.input` indirection is gone (our ref IS the input). The label is now a real `<label htmlFor>` so the field has an accessible name.",
            },
        },
    },
} satisfies Meta<typeof ProviderKeyField>

export default meta
type Story = StoryObj<typeof meta>

const OPENAI: LlmProvider = {name: "OPENAI_API_KEY", title: "OpenAI", key: ""}
const OPENAI_CONFIGURED: LlmProvider = {...OPENAI, key: "sk-live-redacted"}

/** Pre-migration antd markup (static — no save wiring, the form chrome is what is compared). */
const AntdProviderKeyField = ({
    provider,
    disabled,
    hideHeader,
    keyValue = "",
    saving,
}: {
    provider: LlmProvider
    disabled?: boolean
    hideHeader?: boolean
    keyValue?: string
    saving?: boolean
}) => {
    const hasKey = !!provider.key
    return (
        <div className="flex flex-col gap-3">
            {hideHeader ? (
                hasKey ? (
                    <Typography.Text className="!inline-flex !items-center !gap-1 !text-[11px] !text-[var(--ag-colorSuccess)]">
                        <CheckCircle size={13} weight="fill" />
                        Key configured · enter a new value to replace it.
                    </Typography.Text>
                ) : null
            ) : (
                <div className="flex flex-col gap-0.5">
                    <Typography.Text className="!text-[13px] !font-semibold">
                        {provider.title}
                    </Typography.Text>
                    <Typography.Text type="secondary" className="!text-xs !leading-snug">
                        Standard provider · add your key and we auto-list its models.
                    </Typography.Text>
                    {hasKey ? (
                        <Typography.Text className="!mt-1 !inline-flex !items-center !gap-1 !text-[11px] !text-[var(--ag-colorSuccess)]">
                            <CheckCircle size={13} weight="fill" />
                            Key configured · enter a new value to replace it.
                        </Typography.Text>
                    ) : null}
                </div>
            )}
            <div className="flex flex-col gap-1.5">
                <Typography.Text className="!text-xs !font-medium">
                    API key <span className="text-[var(--ag-colorError)]">*</span>
                </Typography.Text>
                <div className="flex items-center gap-2">
                    <AntInput.Password
                        value={keyValue}
                        placeholder="sk-…"
                        className="flex-1 font-mono"
                        disabled={disabled}
                    />
                    <AntButton
                        type="primary"
                        loading={saving}
                        disabled={disabled || !keyValue.trim()}
                    >
                        {hasKey ? "Replace" : "Save"}
                    </AntButton>
                </div>
                <Typography.Text type="secondary" className="!text-[11px]">
                    This secret is encrypted in transit and at rest.
                </Typography.Text>
            </div>
        </div>
    )
}

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
            <div className="w-[400px]" data-vrt-subject>
                {a}
            </div>
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div className="w-[400px]" data-vrt-subject>
                {s}
            </div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    args: {provider: OPENAI},
    render: () => (
        <div className="flex max-w-[1050px] flex-col">
            <Row
                label="no key yet"
                expected="the live component auto-focuses an empty key field (its own effect, unchanged by the migration) so the agenta half shows the focus border + glow the static antd replay cannot; the same crop also carries the two known glyph/font deltas — phosphor Eye vs antd's EyeInvisibleOutlined, and a monospace placeholder (antd's `.ant-input` pins its own font-family, so the call site's `font-mono` never reached the field; ours is `font-[inherit]`)"
                a={<AntdProviderKeyField provider={OPENAI} />}
                s={<ProviderKeyField provider={OPENAI} />}
            />
            <Row
                label="configured"
                a={<AntdProviderKeyField provider={OPENAI_CONFIGURED} />}
                s={<ProviderKeyField provider={OPENAI_CONFIGURED} />}
            />
            <Row
                label="hideHeader"
                a={<AntdProviderKeyField provider={OPENAI_CONFIGURED} hideHeader />}
                s={<ProviderKeyField provider={OPENAI_CONFIGURED} hideHeader />}
            />
            <Row
                label="disabled"
                a={<AntdProviderKeyField provider={OPENAI_CONFIGURED} disabled />}
                s={<ProviderKeyField provider={OPENAI_CONFIGURED} disabled />}
            />
        </div>
    ),
}
