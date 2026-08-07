import type {ReactNode} from "react"

import {SelectionSummary} from "@agenta/playground-ui/testset-selection"
import {borderColors, statusColors} from "@agenta/ui/styles"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Button as AntButton, Space as AntSpace, Typography as AntTypography} from "antd"

// SelectionSummary — the TestsetSelectionModal footer.
//
// The interesting swap here is Typography, and it is the wave-1/2 token trap in miniature.
// Read straight off antd 6.3.7's own style source (lib/typography/style/index.js):
//
//   .ant-typography             → colorText
//   .ant-typography-secondary   → colorTextDescription   (NOT colorTextSecondary)
//   .ant-typography-warning     → colorWarningText       (NOT colorWarning)
//   strong                      → fontWeightStrong = 600 (font-semibold)
//
// And the nesting matters: `<Text strong>` inside `<Text type="secondary">` renders its own
// `.ant-typography` span, so it carries colorText and does NOT inherit the secondary tint.
// The migrated markup reproduces that with an explicit `text-colorText` on the inner spans.
//
// Other swaps: antd `Space` (default size small = 8px) → `flex items-center gap-2`; bare antd
// `Button` (default = outlined) → `variant="outline"`; `type="primary"` → default variant;
// `type="primary" danger` → `variant="destructive"`; `loading` → `LoadingButton`.
const meta = {
    title: "@agenta/playground-ui/TestsetSelection/SelectionSummary",
    component: SelectionSummary,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Modal footer: selection count, compatibility warning, and the confirm/cancel pair.",
            },
        },
    },
} satisfies Meta<typeof SelectionSummary>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined
const {Text} = AntTypography

/** Pre-migration body, verbatim from `git show main:…/SelectionSummary.tsx`. */
const AntdSummary = ({
    selectedCount = 3,
    totalCount = 12,
    confirmDisabled = false,
    confirmText = "Confirm Selection",
    disabled = false,
    disabledMessage = "Cannot select items from this testset",
    warningMessage,
    hasWarning = false,
    isCreateMode = false,
    createDisabled = false,
    createLoading = false,
}: {
    selectedCount?: number
    totalCount?: number
    confirmDisabled?: boolean
    confirmText?: string
    disabled?: boolean
    disabledMessage?: string
    warningMessage?: string
    hasWarning?: boolean
    isCreateMode?: boolean
    createDisabled?: boolean
    createLoading?: boolean
}) => {
    if (disabled) {
        return (
            <div className="flex flex-col gap-3">
                <div
                    className={`border ${borderColors.default} rounded-md p-3 ${statusColors.warningBg}`}
                >
                    <Text type="warning">{disabledMessage}</Text>
                </div>
                <div className="flex items-center justify-end">
                    <AntButton onClick={noop}>Cancel</AntButton>
                </div>
            </div>
        )
    }

    if (isCreateMode) {
        return (
            <div className="flex flex-col gap-3">
                <div className="flex items-center justify-end">
                    <AntSpace>
                        <AntButton onClick={noop}>Cancel</AntButton>
                        <AntButton
                            type="primary"
                            onClick={noop}
                            disabled={createDisabled}
                            loading={createLoading}
                        >
                            Create &amp; Load
                        </AntButton>
                    </AntSpace>
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-3">
            {hasWarning && warningMessage && (
                <div
                    className={`border ${borderColors.default} rounded-md p-3 ${statusColors.warningBg}`}
                >
                    <Text type="warning">{warningMessage}</Text>
                </div>
            )}
            <div className="flex items-center justify-between">
                <div>
                    <Text type="secondary">
                        <Text strong>{selectedCount}</Text> of <Text strong>{totalCount}</Text>{" "}
                        testcases selected
                    </Text>
                </div>
                <AntSpace>
                    <AntButton onClick={noop}>Cancel</AntButton>
                    <AntButton
                        type="primary"
                        danger={hasWarning}
                        onClick={noop}
                        disabled={confirmDisabled}
                    >
                        {confirmText}
                    </AntButton>
                </AntSpace>
            </div>
        </div>
    )
}

const Row = ({
    label,
    a,
    s,
    expected,
}: {
    label: string
    a: ReactNode
    s: ReactNode
    expected?: string
}) => (
    <div
        className="grid grid-cols-[8rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3"
        data-vrt-expected={expected}
    >
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-start gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            <div data-vrt-subject className="flex-1">
                {a}
            </div>
        </div>
        <div className="flex items-start gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            <div data-vrt-subject className="flex-1">
                {s}
            </div>
        </div>
    </div>
)

const base = {onConfirm: noop, onCancel: noop, selectedCount: 3, totalCount: 12}

export const AntdVsAgenta: Story = {
    args: {...base},
    render: () => (
        <div className="flex max-w-[1100px] flex-col">
            <Row label="default" a={<AntdSummary />} s={<SelectionSummary {...base} />} />
            <Row
                label="confirm disabled"
                a={<AntdSummary confirmDisabled />}
                s={<SelectionSummary {...base} confirmDisabled />}
            />
            <Row
                label="warning"
                a={<AntdSummary hasWarning warningMessage="Inputs do not match this testset." />}
                s={
                    <SelectionSummary
                        {...base}
                        hasWarning
                        warningMessage="Inputs do not match this testset."
                    />
                }
            />
            <Row
                label="disabled"
                a={<AntdSummary disabled />}
                s={<SelectionSummary {...base} disabled />}
            />
            <Row
                label="create mode"
                a={<AntdSummary isCreateMode />}
                s={<SelectionSummary {...base} isCreateMode />}
            />
            <Row
                label="create loading"
                a={<AntdSummary isCreateMode createLoading />}
                s={<SelectionSummary {...base} isCreateMode createLoading />}
                expected="antd's loading Button renders a leading spinner and takes the disabled skin; LoadingButton keeps the variant colours and blocks activation via pointer-events + a click guard (documented deviation, see button-composed.tsx). Spinner glyph differs: antd 4-dot vs lucide LoaderCircle."
            />
        </div>
    ),
}
