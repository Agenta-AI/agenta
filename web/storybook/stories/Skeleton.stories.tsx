import {Skeleton, SkeletonAvatar, SkeletonBlock} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Primitives/Feedback/Skeleton",
    component: Skeleton,
    subcomponents: {SkeletonAvatar, SkeletonBlock},
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A loading placeholder with optional avatar, title and paragraph lines and an `active` shimmer. See the subcomponent tables below for `SkeletonAvatar` and `SkeletonBlock`.\n\n**Used in:** `Skeleton` in 3 places (`LoadingSkeleton`, the editor plugin fallback, and `SectionSkeleton` which is itself unused); `SkeletonBlock` in 2 (`LoadingSkeleton`, `ExecutionMetricsDisplay`); `SkeletonAvatar` only in `LoadingSkeleton`. `LoadingSkeleton` renders in exactly one place — the shared entity table.",
            },
        },
    },
} satisfies Meta<typeof Skeleton>

export default meta
type Story = StoryObj<typeof meta>

// Skeletons are block-width, so each row holds a fixed-width box.
const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="w-[320px]">{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[560px] flex-col">
            <Row label="base block">
                <SkeletonBlock className="h-7" />
            </Row>
            <Row label="default (title + paragraph)">
                <Skeleton />
            </Row>
            <Row label="avatar + title + paragraph">
                <Skeleton avatar />
            </Row>
            <Row label="active (shimmer)">
                <Skeleton active avatar />
            </Row>
            <Row label="title only">
                <Skeleton paragraph={false} />
            </Row>
            <Row label="avatar (circle, lg)">
                <SkeletonAvatar size="large" shape="circle" />
            </Row>
        </div>
    ),
}
