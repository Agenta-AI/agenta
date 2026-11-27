import {FormattedDate} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Presentational/Labels/FormattedDate",
    component: FormattedDate,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A presentational date formatter (dayjs) that copies the raw ISO value on click, with an optional badge wrapper. Built on the @agenta/ui Tooltip + Badge.\n\n**Used in:** 1 place — the workflow revision drawer metadata sidebar (`@agenta/playground-ui`).",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const SAMPLE = "2026-07-24T14:32:00.000Z"

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr] items-center gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2 text-xs text-colorText">{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[820px] flex-col">
            <Row label="default">
                <FormattedDate date={SAMPLE} />
            </Row>
            <Row label="custom format">
                <FormattedDate date={SAMPLE} format="YYYY-MM-DD" />
            </Row>
            <Row label="asTag">
                <FormattedDate date={SAMPLE} asTag />
            </Row>
            <Row label="null → fallback">
                <FormattedDate date={null} fallback="Never" />
            </Row>
        </div>
    ),
}
