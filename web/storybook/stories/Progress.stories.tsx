import type {Meta, StoryObj} from "@storybook/nextjs"

// Progress is not exported from the `@agenta/ui/ui` barrel yet, so the story imports
// the primitive directly by path.
import {Progress} from "../../packages/agenta-ui/src/components/ui/progress"

const meta = {
    title: "@agenta/ui/Primitives/Feedback/Progress",
    component: Progress,
    parameters: {
        docs: {
            description: {
                component:
                    'A line or circle progress indicator with `percent`, `size`, `status`, `showInfo`, `strokeColor` and `trailColor` props. The circle variant (`type="circle"`) takes a numeric `size` as the diameter and `strokeWidth` as a percent of it. `type="dashboard"` is not supported.\n\n**Used in:** 2 places — the prompt image upload progress bar (line) and the entity picker `LoadAllButton` (circle). Both variants ship; nothing renders it from app code directly.',
            },
        },
    },
} satisfies Meta<typeof Progress>

export default meta
type Story = StoryObj<typeof meta>

// A fixed-width slot keeps the full-width (width:100%) line progress a consistent size.
const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[14rem_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="w-[200px]">{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[480px] flex-col">
            {/* percent values × showInfo, status, and small size */}
            <Row label="0% · info">
                <Progress percent={0} />
            </Row>
            <Row label="30% · info">
                <Progress percent={30} />
            </Row>
            <Row label="60% · info">
                <Progress percent={60} />
            </Row>
            <Row label="60% · no info">
                <Progress percent={60} showInfo={false} />
            </Row>
            <Row label="status normal (50%)">
                <Progress percent={50} status="normal" />
            </Row>
            <Row label="status success (100%)">
                <Progress percent={100} status="success" />
            </Row>
            <Row label="status exception (70%)">
                <Progress percent={70} status="exception" />
            </Row>
            <Row label="auto-success (100%)">
                <Progress percent={100} />
            </Row>
            <Row label="small · 40% · info">
                <Progress percent={40} size="small" />
            </Row>
            <Row label="small · no info">
                <Progress percent={40} size="small" showInfo={false} />
            </Row>
            <Row label="small · success (100%)">
                <Progress percent={100} size="small" status="success" />
            </Row>
            <Row label="small · exception (80%)">
                <Progress percent={80} size="small" status="exception" />
            </Row>

            {/* strokeColor / trailColor overrides (call-site: Onboarding WidgetSection) */}
            <Row label="strokeColor + trailColor">
                <Progress
                    percent={65}
                    size="small"
                    strokeColor="var(--ag-colorPrimary)"
                    trailColor="var(--ag-colorFill)"
                />
            </Row>

            {/* type="circle" — `size` is the DIAMETER (default 120) and `strokeWidth` is a
                percent of it (default max(3/size*100, 6)). */}
            <Row label="circle · default (0%)">
                <Progress type="circle" percent={0} />
            </Row>
            <Row label="circle · default (60%)">
                <Progress type="circle" percent={60} />
            </Row>
            <Row label="circle · 20px · stroke 10 (LoadAllButton)">
                <Progress type="circle" percent={45} size={20} strokeWidth={10} showInfo={false} />
            </Row>
            <Row label="circle · auto-success (100%)">
                <Progress type="circle" percent={100} />
            </Row>
            <Row label="circle · exception (70%)">
                <Progress type="circle" percent={70} status="exception" />
            </Row>
        </div>
    ),
}
