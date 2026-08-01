import {Skeleton, SkeletonAvatar, SkeletonBlock} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Skeleton as AntSkeleton} from "antd"

// Phase-0 parity story: the REAL antd Skeleton behind the app theme, side by side with the
// @agenta/ui re-skin. antd active/avatar/title/paragraph/loading map 1:1. The `active`
// shimmer is a CSS animation — the VRT compares it at a frozen frame.
const meta = {
    title: "@agenta/ui/Primitives/Feedback/Skeleton",
    component: AntSkeleton,
    subcomponents: {"Skeleton (@agenta/ui)": Skeleton, SkeletonAvatar, SkeletonBlock},
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "antd `Skeleton` (interactive playground) shown beside the `@agenta/ui` Skeleton that replaces it. See the subcomponent tables below for the agenta props.\n\n**Used in:** `Skeleton` in 3 places (`LoadingSkeleton`, the editor plugin fallback, and `SectionSkeleton` which is itself unused); `SkeletonBlock` in 2 (`LoadingSkeleton`, `ExecutionMetricsDisplay`); `SkeletonAvatar` only in `LoadingSkeleton`. `LoadingSkeleton` renders in exactly one place — the shared entity table.",
            },
        },
    },
} satisfies Meta<typeof AntSkeleton>

export default meta
type Story = StoryObj<typeof meta>

// `.grid` Row: [label | antd cell | agenta cell] — the VRT pairs the Skeleton in each cell.
// Skeletons are block-width, so each cell holds a fixed-width box for consistent measurement.
const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            {/* data-vrt-subject: skeletons are title+paragraph rows — crop the whole block */}
            <div className="w-[320px]" data-vrt-subject>
                {a}
            </div>
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div className="w-[320px]" data-vrt-subject>
                {s}
            </div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[760px] flex-col">
            <Row
                label="base block"
                a={<AntSkeleton.Button block />}
                s={<SkeletonBlock className="h-7" />}
            />
            <Row label="default (title + paragraph)" a={<AntSkeleton />} s={<Skeleton />} />
            <Row
                label="avatar + title + paragraph"
                a={<AntSkeleton avatar />}
                s={<Skeleton avatar />}
            />
            <Row
                label="active (shimmer)"
                a={<AntSkeleton active avatar />}
                s={<Skeleton active avatar />}
            />
            <Row
                label="title only"
                a={<AntSkeleton paragraph={false} />}
                s={<Skeleton paragraph={false} />}
            />
            <Row
                label="avatar (circle, lg)"
                a={<AntSkeleton.Avatar size="large" shape="circle" />}
                s={<SkeletonAvatar size="large" shape="circle" />}
            />
        </div>
    ),
}
