import type {Meta, StoryObj} from "@storybook/nextjs"
import {Alert as AntAlert, Button as AntButton} from "antd"

// Imported from source: agentTemplate internals are not re-exported from the DrillInView barrel.
import {CatalogUnavailableNotice} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/CatalogUnavailableNotice"

// CatalogUnavailableNotice — shown when the schema declares `x-ag-harness-ref` but the harness
// catalog fetch failed, so the pane falls back to the basic controls. Extracted from
// `useModelHarness` so it can be storied with plain props. Migration: antd `Alert` → `@agenta/ui`
// `Alert`; antd's `action` slot is NOT implemented on the primitive, so the Retry button is
// composed into the description row (declared divergence).
//
// The antd half replays the pre-migration markup from
// `git show feat/storybook-data-seam:web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/useModelHarness.tsx`
// (`catalogUnavailableNotice`).
const meta = {
    title: "@agenta/entity-ui/DrillIn/CatalogUnavailableNotice",
    component: CatalogUnavailableNotice,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Warning alert with a Retry action for a failed harness-catalog fetch. antd `Alert action` has no `@agenta/ui` equivalent (migrations/Alert.md marks it deferred), so the button is composed into the description.",
            },
        },
    },
} satisfies Meta<typeof CatalogUnavailableNotice>

export default meta
type Story = StoryObj<typeof meta>

const MESSAGE = "Couldn't load the model catalog"
const DESCRIPTION =
    "The harness and model options come from the server. Until it responds, only the basic controls are available."

/** Pre-migration antd markup. */
const AntdCatalogUnavailable = () => (
    <AntAlert
        type="warning"
        showIcon
        message={MESSAGE}
        description={DESCRIPTION}
        action={<AntButton size="small">Retry</AntButton>}
    />
)

/** The error state — this component has no other state (it only renders when the fetch failed). */
export const Default: Story = {
    args: {onRetry: () => undefined},
    render: () => (
        <div className="max-w-[560px]">
            <CatalogUnavailableNotice onRetry={() => undefined} />
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
        className="grid grid-cols-[8rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3"
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
    args: {onRetry: () => undefined},
    render: () => (
        <div className="flex max-w-[1050px] flex-col">
            <Row
                label="catalog failed"
                expected="antd `Alert action` is not built on the @agenta/ui Alert — the Retry button is composed into the description row, so it sits one line lower (right-aligned) instead of in antd's trailing action slot"
                a={<AntdCatalogUnavailable />}
                s={<CatalogUnavailableNotice onRetry={() => undefined} />}
            />
        </div>
    ),
}
