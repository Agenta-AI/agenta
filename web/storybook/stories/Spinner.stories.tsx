import type {Meta, StoryObj} from "@storybook/nextjs"

// Spinner is not exported from the `@agenta/ui/ui` barrel yet (index.ts is off-limits for
// this change), so the story imports the primitive directly from its source file.
import {Spinner} from "../../packages/agenta-ui/src/components/ui/spinner"

const meta = {
    title: "@agenta/ui/Primitives/Feedback/Spinner",
    component: Spinner,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A loading spinner (rotating 4-dot square) with `size` (small, default, large) and `tip` props.\n\n**Used in:** 12 places — four entity picker variants, the searchable list/popover and virtual list shells, `LoadMoreButton`/`LoadAllButton`, `SharedEditor`, the prompt image upload, and the toast.",
            },
        },
    },
} satisfies Meta<typeof Spinner>

export default meta
type Story = StoryObj<typeof meta>

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex h-16 items-center">{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[480px] flex-col">
            <Row label="small">
                <Spinner size="small" />
            </Row>
            <Row label="default">
                <Spinner size="default" />
            </Row>
            <Row label="large">
                <Spinner size="large" />
            </Row>
            <Row label="with tip">
                <Spinner tip="Loading…" />
            </Row>
        </div>
    ),
}

export const Sizes: Story = {
    render: () => (
        <div className="flex items-center gap-8">
            <Spinner size="small" />
            <Spinner size="default" />
            <Spinner size="large" />
        </div>
    ),
}

export const WithTip: Story = {
    render: () => (
        <div className="flex items-center gap-8">
            <Spinner size="small" tip="Loading…" />
            <Spinner size="default" tip="Loading…" />
            <Spinner size="large" tip="Loading…" />
        </div>
    ),
}
