import {LoadingSkeleton} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Presentational/Feedback/LoadingSkeleton",
    component: LoadingSkeleton,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    'One loading placeholder with `variant="paragraph"` (N text rows — was `TableLoadingState`) and `variant="list"` (avatar + line per row — was `ListItemSkeleton`). Built on the @agenta/ui `Skeleton` primitive.\n\n**Used in:** 1 place — the shared entity table (`@agenta/entity-ui` `shared/EntityTable.tsx`).',
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const Row = ({
    label,
    children,
    w = 320,
}: {
    label: string
    children: React.ReactNode
    w?: number
}) => (
    <div className="grid grid-cols-[14rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div style={{width: w}}>{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[860px] flex-col">
            <Row label="paragraph · 4 rows">
                <LoadingSkeleton variant="paragraph" rows={4} />
            </Row>
            <Row label="paragraph · default (8 rows)">
                <LoadingSkeleton variant="paragraph" />
            </Row>
            <Row label="list · avatar (count 3)" w={280}>
                <LoadingSkeleton variant="list" count={3} showAvatar />
            </Row>
            <Row label="list · no avatar" w={280}>
                <LoadingSkeleton variant="list" count={3} showAvatar={false} />
            </Row>
            <Row label="list · circle avatar" w={280}>
                <LoadingSkeleton variant="list" count={2} showAvatar avatarShape="circle" />
            </Row>
        </div>
    ),
}
