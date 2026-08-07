import {LoadingSkeleton} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Skeleton} from "antd"

// LoadingSkeleton — one loading placeholder with two variants: `paragraph` (N text rows, replaces
// the old TableLoadingState) and `list` (avatar + line per row, replaces the old ListItemSkeleton).
// Built on the @agenta/ui Skeleton primitive (migrated off raw antd Skeleton). The antd column shows
// the raw antd Skeleton shapes each variant used to render.
const meta = {
    title: "@agenta/ui/Presentational/Feedback/LoadingSkeleton",
    component: LoadingSkeleton,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    'One loading placeholder with `variant="paragraph"` (N text rows — was `TableLoadingState`) and `variant="list"` (avatar + line per row — was `ListItemSkeleton`). Built on the @agenta/ui `Skeleton` primitive; shown next to the raw antd shapes it replaces.\n\n**Used in:** 1 place — the shared entity table (`@agenta/entity-ui` `shared/EntityTable.tsx`).',
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const Row = ({
    label,
    a,
    s,
    w = 320,
}: {
    label: string
    a: React.ReactNode
    s: React.ReactNode
    w?: number
}) => (
    <div className="grid grid-cols-[14rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            {/* data-vrt-subject: multi-row skeletons — crop the whole block, not the first bar */}
            <div style={{width: w}} data-vrt-subject>
                {a}
            </div>
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div style={{width: w}} data-vrt-subject>
                {s}
            </div>
        </div>
    </div>
)

// Verbatim reproduction of the pre-migration antd `ListItemSkeleton` body (commit a6b3e1169c):
// `p-3 rounded-md bg-zinc-1` rows, `Skeleton.Input active size="small" block !w-3/4 mb-1`.
const AntdListRows = ({
    count,
    avatar,
    shape = "square",
}: {
    count: number
    avatar?: boolean
    shape?: "square" | "circle"
}) => (
    <div className="space-y-2">
        {Array.from({length: count}).map((_, i) => (
            <div key={i} className="flex items-center p-3 rounded-md bg-zinc-1">
                {avatar && <Skeleton.Avatar active size="small" shape={shape} className="mr-3" />}
                <div className="flex-1">
                    <Skeleton.Input active size="small" block className="!w-3/4 mb-1" />
                </div>
            </div>
        ))}
    </div>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[860px] flex-col">
            {/* antd half = the pre-migration `TableLoadingState` body (commit ce889f89fd):
                `<Skeleton active paragraph={{rows}} />` — antd's default `title` bar included. */}
            <Row
                label="paragraph · 4 rows"
                a={<Skeleton active paragraph={{rows: 4}} />}
                s={<LoadingSkeleton variant="paragraph" rows={4} />}
            />
            <Row
                label="paragraph · default (8 rows)"
                a={<Skeleton active paragraph={{rows: 8}} />}
                s={<LoadingSkeleton variant="paragraph" />}
            />
            <Row
                label="list · avatar (count 3)"
                a={<AntdListRows count={3} avatar />}
                s={<LoadingSkeleton variant="list" count={3} showAvatar />}
                w={280}
            />
            <Row
                label="list · no avatar"
                a={<AntdListRows count={3} />}
                s={<LoadingSkeleton variant="list" count={3} showAvatar={false} />}
                w={280}
            />
            <Row
                label="list · circle avatar"
                a={<AntdListRows count={2} avatar shape="circle" />}
                s={<LoadingSkeleton variant="list" count={2} showAvatar avatarShape="circle" />}
                w={280}
            />
        </div>
    ),
}
