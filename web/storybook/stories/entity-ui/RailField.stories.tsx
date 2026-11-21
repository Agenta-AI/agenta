import {
    ChangedPathsProvider,
    RailField,
    railInfoLabel,
    type ChangedPaths,
} from "@agenta/entity-ui/drawers/shared"
import {Input} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

// RailField — one `[label column │ content]` drawer row.
const meta = {
    title: "@agenta/entity-ui/Drawers/RailField",
    component: RailField,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A fixed 116px label column beside a bordered content panel, with an optional changed-property marker (dotted underline + click popover).",
            },
        },
    },
} satisfies Meta<typeof RailField>

export default meta
type Story = StoryObj<typeof meta>

const changedStub: ChangedPaths = {
    isChanged: (path) => path === "runner.permissions.default",
    hasChangedUnder: () => true,
    pathsUnder: () => ["runner.permissions.default"],
    changeFor: () => ({before: '"ask"', after: '"allow"'}),
    revert: () => undefined,
}

const content = <span className="py-1 text-xs text-[var(--ag-colorText)]">acceptEdits</span>

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[10rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div>{children}</div>
    </div>
)

export const Variants: Story = {
    args: {label: "Permissions", children: content},
    render: () => (
        <div className="flex max-w-[640px] flex-col">
            <Row label="plain (top align)">
                <RailField label="Permissions">{content}</RailField>
            </Row>
            <Row label="center align">
                <RailField label="Model" align="center">
                    <Input placeholder="claude-sonnet-4" />
                </RailField>
            </Row>
            <Row label="info label (tooltip)">
                <RailField label={railInfoLabel("Sandbox", "Where the agent runs")}>
                    {content}
                </RailField>
            </Row>
            <Row label="changed property">
                <ChangedPathsProvider changes={changedStub}>
                    <RailField label="Default mode" path="runner.permissions.default">
                        {content}
                    </RailField>
                </ChangedPathsProvider>
            </Row>
        </div>
    ),
}
