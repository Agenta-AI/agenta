import type {Meta, StoryObj} from "@storybook/nextjs"
import {Typography} from "antd"

// Field/Label aren't on the @agenta/ui barrel yet → relative source imports. The antd reference
// is the LABEL MARKUP the removed `LabeledField` used to render (a `font-medium` antd
// Typography.Text span), inlined so the comparison survives that component's deletion.
import {Field} from "../../packages/agenta-ui/src/components/ui/field"
import {Input} from "../../packages/agenta-ui/src/components/ui/input"

const meta = {
    title: "@agenta/ui/Primitives/Forms/Field",
    component: Field,
    parameters: {
        docs: {
            description: {
                component:
                    "The `@agenta/ui` Field — a label + control wrapper that consolidated the app's antd-based `LabeledField` (antd Tooltip + Typography), plus `required`/`description`/`error`/`tooltip`. `LabeledField` has been deleted; callers use `<Field>` directly.\n\n**Used in:** 11 places — nine agent config drill-in controls (`@agenta/entity-ui/DrillInView/SchemaControls`: text input, enum select, code editor, grouped choice, harness select, hook config, feedback config, tags editor, skill form) plus `CommitMessageInput` and `LabelInput`.",
            },
        },
    },
} satisfies Meta
export default meta
type Story = StoryObj

const CONTROL_BOX = "w-[220px] shrink-0"

// The antd reference: LabeledField's exact label markup — `[data-slot=field-header]` marker,
// its `flex items-center gap-1` row, and an antd `Typography.Text` (NOT a bare span: only
// `.ant-typography` gets antd's resetComponent line-height).
const RefLabel = ({children}: {children: React.ReactNode}) => (
    <div data-slot="field-header">
        <div className="flex items-center gap-1">
            <Typography.Text className="font-medium text-xs text-colorText">
                {children}
            </Typography.Text>
        </div>
    </div>
)

/**
 * Field is a COMPOSITE (label region + control). The `data-vrt-subject` sizing box crops the
 * whole cell; only the "label only" row is pixel-gated (rows adding control chrome are marked
 * "not reproduced"), so the compared region is still the label chrome Field owns. The antd cell
 * keeps its `[data-slot=field-header]` marker so both halves render the same label markup.
 */
const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[16rem_auto_auto] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-start gap-2">
            <span className="w-12 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            {/* data-vrt-subject on the sizing box: header + tooltip trigger + input can co-occur */}
            <div className={CONTROL_BOX} data-vrt-subject>
                {a}
            </div>
        </div>
        <div className="flex items-start gap-2">
            <span className="w-12 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            <div className={CONTROL_BOX} data-vrt-subject>
                {s}
            </div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[900px] flex-col">
            {/* LABEL-REGION PARITY (VRT-compared): label region only, identical text. */}
            <Row
                label="label only"
                a={<RefLabel>Temperature</RefLabel>}
                s={<Field label="Temperature">{null}</Field>}
            />

            {/*
             * Rows below ADD or DIVERGE from the old LabeledField, so each is marked
             * "not reproduced" (the VRT skips rows whose label matches /not reproduced/i) and is
             * verified by computed-style. They still render so the a11y (axe) gate exercises the
             * tooltip trigger + label↔control association.
             */}

            {/* tooltip: LabeledField's `description` → Field's `tooltip`. Icon glyph is an
                intentional swap (phosphor Info vs antd InfoCircleOutlined) → not reproduced. */}
            <Row
                label="tooltip (icon swap — not reproduced)"
                a={
                    <div className="flex flex-col gap-1">
                        <RefLabel>Temperature</RefLabel>
                        <Input aria-label="Temperature" placeholder="0.7" />
                    </div>
                }
                s={
                    <Field label="Temperature" tooltip="Controls randomness">
                        <Input placeholder="0.7" />
                    </Field>
                }
            />

            {/* required: Field renders a `colorError` asterisk (antd Form.Item convention);
                the old label baked a plain-text " *" into the string. Deliberate → not reproduced. */}
            <Row
                label="required (red asterisk — not reproduced)"
                a={
                    <div className="flex flex-col gap-1">
                        <RefLabel>API key *</RefLabel>
                        <Input aria-label="API key" placeholder="sk-..." />
                    </div>
                }
                s={
                    <Field label="API key" required>
                        <Input placeholder="sk-..." />
                    </Field>
                }
            />

            {/* horizontal: layout, not label chrome — shown with real controls, not VRT-gated. */}
            <Row
                label="horizontal (layout — not reproduced)"
                a={
                    <div className="flex items-center gap-2">
                        <span className="shrink-0 text-xs font-medium text-colorText">Stream</span>
                        <Input aria-label="Stream" placeholder="on" />
                    </div>
                }
                s={
                    <Field label="Stream" direction="horizontal">
                        <Input placeholder="on" />
                    </Field>
                }
            />

            {/* description (help subtext) — NEW capability the old LabeledField lacked. */}
            <Row
                label="description (new — not reproduced)"
                a={
                    <div className="flex flex-col gap-1">
                        <RefLabel>Model</RefLabel>
                        <span className="text-xs text-colorTextDescription">
                            Pick a chat-capable model
                        </span>
                        <Input aria-label="Model" placeholder="gpt-4o" />
                    </div>
                }
                s={
                    <Field label="Model" description="Pick a chat-capable model">
                        <Input placeholder="gpt-4o" />
                    </Field>
                }
            />

            {/* error (help/error line) — NEW capability the old LabeledField lacked. */}
            <Row
                label="error (new — not reproduced)"
                a={
                    <div className="flex flex-col gap-1">
                        <RefLabel>API key</RefLabel>
                        <Input aria-label="API key" aria-invalid placeholder="sk-..." />
                        <span className="text-xs text-colorError">This field is required</span>
                    </div>
                }
                s={
                    <Field label="API key" error="This field is required">
                        <Input aria-invalid placeholder="sk-..." />
                    </Field>
                }
            />
        </div>
    ),
}
