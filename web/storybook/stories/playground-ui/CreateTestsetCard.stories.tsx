import type {ReactNode} from "react"

import {CreateTestsetCard} from "@agenta/playground-ui/testset-selection"
import {InboxOutlined} from "@ant-design/icons"
import {Table} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Button as AntButton, Typography as AntTypography, Upload as AntUpload} from "antd"

// CreateTestsetCard — the "Create a new testset" affordance inside TestsetSelectionModal.
//
// This is wave 3's `Upload` case: antd `Upload.Dragger` has no @agenta/ui primitive, so the
// drop zone is rebuilt from native drag handlers + a hidden file input, following the
// SkillUploadZone precedent from wave 2 (structure only — its `--ag-c-*` literals are not
// reused; the maintainer checklist rejects them).
//
// Other swaps: `InboxOutlined` → phosphor `Tray`; `Typography.Text` → plain spans; antd
// `Button type="primary" block icon={…}` → `Button` with the icon as a CHILD (the primitive
// has no `icon` prop) + `w-full`. The card's raw `gray-*` classes, which did not respond to
// the theme at all, became semantic tokens — so the dark rows are a deliberate improvement,
// not a regression. See the `data-vrt-expected` note on the dark comparison.
const meta = {
    title: "@agenta/playground-ui/TestsetSelection/CreateTestsetCard",
    component: CreateTestsetCard,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Drop a CSV/JSON to create a testset, or build one in the UI. The drop zone replaces antd Upload.Dragger.",
            },
        },
    },
} satisfies Meta<typeof CreateTestsetCard>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

/** Pre-migration body, verbatim from `git show main:…/CreateTestsetCard.tsx`. */
const AntdCard = ({
    onFileUpload,
    onBuildInUI,
}: {
    onFileUpload?: (file: File) => void
    onBuildInUI?: () => void
}) => (
    <div className="mt-3 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3 py-3 flex flex-col gap-3">
        <AntTypography.Text className="font-medium">Create a new testset</AntTypography.Text>
        <AntUpload.Dragger
            accept=".csv,.json"
            beforeUpload={(file) => {
                onFileUpload?.(file)
                return false
            }}
            showUploadList={false}
            disabled={!onFileUpload}
            className="!bg-[var(--ag-c-FFFFFF)] !border-gray-200 !rounded-xl"
        >
            <div className="flex flex-col items-center justify-center gap-2 py-1">
                <InboxOutlined className="text-gray-400 text-xl" />
                <AntTypography.Text>Drop CSV/JSON here or click to browse</AntTypography.Text>
            </div>
        </AntUpload.Dragger>

        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-gray-400">
            <span className="h-px flex-1 bg-gray-200" />
            <span>or</span>
            <span className="h-px flex-1 bg-gray-200" />
        </div>

        <AntButton
            type="primary"
            block
            disabled={!onBuildInUI}
            icon={<Table size={16} weight="regular" />}
            onClick={onBuildInUI}
        >
            Build in UI
        </AntButton>
    </div>
)

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

export const AntdVsAgenta: Story = {
    args: {onFileUpload: noop, onBuildInUI: noop},
    render: () => (
        <div className="flex max-w-[900px] flex-col">
            <Row
                label="idle"
                a={<AntdCard onFileUpload={noop} onBuildInUI={noop} />}
                s={<CreateTestsetCard onFileUpload={noop} onBuildInUI={noop} />}
                expected="COLOUR ONLY — geometry is now exact (measured in-browser: card 298.3x139 and drop zone 150px tall on BOTH sides; text 12px/20px Inter on both). The surfaces differ because the antd original used raw Tailwind greys that never responded to the theme: card bg gray-50 rgb(249,250,251) → colorFillQuaternary rgba(5,23,41,0.02); card border gray-200 rgb(229,231,235) → colorBorder rgb(189,199,209); icon gray-400 rgb(156,163,175) → colorTextDescription rgb(117,131,145). The inner zone bg is the pair that swaps: antd renders .ant-upload-drag at its own colorFillAlter rgba(5,23,41,0.02) while ours is colorBgContainer white. Only the migrated side is theme-aware, so the dark row is a deliberate improvement, not drift."
            />
            <Row
                label="upload disabled"
                a={<AntdCard onBuildInUI={noop} />}
                s={<CreateTestsetCard onBuildInUI={noop} />}
                expected="same token swap as idle, plus the disabled treatment: antd's .ant-upload-disabled recolours text/icon, ours applies opacity-60 to the same box. Geometry identical."
            />
            <Row
                label="build disabled"
                a={<AntdCard onFileUpload={noop} />}
                s={<CreateTestsetCard onFileUpload={noop} />}
                expected="same token swap as idle; the disabled Button skin is the shared primitive's and is gated by button--antd-vs-agenta."
            />
        </div>
    ),
}
