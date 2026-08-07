import type {Meta, StoryObj} from "@storybook/nextjs"
import {Progress as AntProgress} from "antd"

// Progress is not exported from the `@agenta/ui/ui` barrel yet, so the parity story imports
// the primitive directly by path (antd `percent`/`size`/`status`/`showInfo`/`strokeColor`
// map to the same props on the @agenta/ui component).
import {Progress} from "../../packages/agenta-ui/src/components/ui/progress"

// Phase-0 parity story: the REAL antd Progress (LINE + CIRCLE variants) behind the app theme,
// side by side with the @agenta/ui re-skin.
const meta = {
    title: "@agenta/ui/Primitives/Feedback/Progress",
    component: AntProgress,
    subcomponents: {"Progress (@agenta/ui)": Progress},
    parameters: {
        docs: {
            description: {
                component:
                    'antd `Progress` (interactive playground) shown beside the `@agenta/ui` Progress that replaces it. Both the LINE and the CIRCLE (`type="circle"`, with numeric `size` as the diameter and `strokeWidth` as a percent of it) variants are now supported; `type="dashboard"` is still deferred. See the subcomponent table below for the agenta props.\n\n**Used in:** 2 places — the prompt image upload progress bar (line) and the entity picker `LoadAllButton` (circle). Both variants ship; nothing renders it from app code directly.',
            },
        },
    },
} satisfies Meta<typeof AntProgress>

export default meta
type Story = StoryObj<typeof meta>

// `.grid` Row: [label | antd cell | agenta cell]. A fixed-width slot keeps the full-width
// (width:100%) line progress a consistent size so the VRT compares like for like.
const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[14rem_1fr_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            <div className="w-[200px]">{a}</div>
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            <div className="w-[200px]">{s}</div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[760px] flex-col">
            {/* percent values × showInfo (default size, normal status) */}
            <Row label="0% · info" a={<AntProgress percent={0} />} s={<Progress percent={0} />} />
            <Row
                label="30% · info"
                a={<AntProgress percent={30} />}
                s={<Progress percent={30} />}
            />
            <Row
                label="60% · info"
                a={<AntProgress percent={60} />}
                s={<Progress percent={60} />}
            />
            <Row
                label="60% · no info"
                a={<AntProgress percent={60} showInfo={false} />}
                s={<Progress percent={60} showInfo={false} />}
            />

            {/* status: normal / success / exception (default size) */}
            <Row
                label="status normal (50%)"
                a={<AntProgress percent={50} status="normal" />}
                s={<Progress percent={50} status="normal" />}
            />
            <Row
                label="status success (100%)"
                a={<AntProgress percent={100} status="success" />}
                s={<Progress percent={100} status="success" />}
            />
            <Row
                label="status exception (70%)"
                a={<AntProgress percent={70} status="exception" />}
                s={<Progress percent={70} status="exception" />}
            />
            <Row
                label="auto-success (100%)"
                a={<AntProgress percent={100} />}
                s={<Progress percent={100} />}
            />

            {/* size small × status */}
            <Row
                label="small · 40% · info"
                a={<AntProgress percent={40} size="small" />}
                s={<Progress percent={40} size="small" />}
            />
            <Row
                label="small · no info"
                a={<AntProgress percent={40} size="small" showInfo={false} />}
                s={<Progress percent={40} size="small" showInfo={false} />}
            />
            <Row
                label="small · success (100%)"
                a={<AntProgress percent={100} size="small" status="success" />}
                s={<Progress percent={100} size="small" status="success" />}
            />
            <Row
                label="small · exception (80%)"
                a={<AntProgress percent={80} size="small" status="exception" />}
                s={<Progress percent={80} size="small" status="exception" />}
            />

            {/* strokeColor / trailColor overrides (call-site: Onboarding WidgetSection) */}
            <Row
                label="strokeColor + trailColor"
                a={
                    <AntProgress
                        percent={65}
                        size="small"
                        strokeColor="var(--ag-colorPrimary)"
                        trailColor="var(--ag-colorFill)"
                    />
                }
                s={
                    <Progress
                        percent={65}
                        size="small"
                        strokeColor="var(--ag-colorPrimary)"
                        trailColor="var(--ag-colorFill)"
                    />
                }
            />

            {/* type="circle" — antd's `size` is the DIAMETER (default 120) and `strokeWidth` is
                a percent of it (default max(3/size*100, 6)). */}
            <Row
                label="circle · default (0%)"
                a={<AntProgress type="circle" percent={0} />}
                s={<Progress type="circle" percent={0} />}
            />
            <Row
                label="circle · default (60%)"
                a={<AntProgress type="circle" percent={60} />}
                s={<Progress type="circle" percent={60} />}
            />
            <Row
                label="circle · 20px · stroke 10 (LoadAllButton)"
                a={
                    <AntProgress
                        type="circle"
                        percent={45}
                        size={20}
                        strokeWidth={10}
                        showInfo={false}
                    />
                }
                s={
                    <Progress
                        type="circle"
                        percent={45}
                        size={20}
                        strokeWidth={10}
                        showInfo={false}
                    />
                }
            />
            <Row
                label="circle · auto-success (100%)"
                a={<AntProgress type="circle" percent={100} />}
                s={<Progress type="circle" percent={100} />}
            />
            <Row
                label="circle · exception (70%)"
                a={<AntProgress type="circle" percent={70} status="exception" />}
                s={<Progress type="circle" percent={70} status="exception" />}
            />
        </div>
    ),
}
