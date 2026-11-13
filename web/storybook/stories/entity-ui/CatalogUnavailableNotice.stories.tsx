import type {Meta, StoryObj} from "@storybook/nextjs"

// Imported from source: agentTemplate internals are not re-exported from the DrillInView barrel.
import {CatalogUnavailableNotice} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/CatalogUnavailableNotice"

// CatalogUnavailableNotice — shown when the schema declares `x-ag-harness-ref` but the harness
// catalog fetch failed, so the pane falls back to the basic controls. Extracted from
// `useModelHarness` so it can be storied with plain props.
const meta = {
    title: "@agenta/entity-ui/DrillIn/CatalogUnavailableNotice",
    component: CatalogUnavailableNotice,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Warning alert with a Retry action for a failed harness-catalog fetch. The Retry button sits in the description row.",
            },
        },
    },
} satisfies Meta<typeof CatalogUnavailableNotice>

export default meta
type Story = StoryObj<typeof meta>

/** The error state — this component has no other state (it only renders when the fetch failed). */
export const Default: Story = {
    args: {onRetry: () => undefined},
    render: () => (
        <div className="max-w-[560px]">
            <CatalogUnavailableNotice onRetry={() => undefined} />
        </div>
    ),
}

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[8rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="w-[420px]">{children}</div>
    </div>
)

export const Variants: Story = {
    args: {onRetry: () => undefined},
    render: () => (
        <div className="flex max-w-[1050px] flex-col">
            <Row label="catalog failed">
                <CatalogUnavailableNotice onRetry={() => undefined} />
            </Row>
        </div>
    ),
}
