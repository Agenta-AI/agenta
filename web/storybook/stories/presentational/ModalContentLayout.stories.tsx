import {ModalContentLayout} from "@agenta/ui/components/presentational"
import {Button} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Divider as AntDivider} from "antd"

// ModalContentLayout — a modal body layout: picker (left) + content (right) via SplitPanelLayout,
// with an optional bordered footer. It is antd-free itself, but SplitPanelLayout's vertical rule
// was an antd `Divider` before the migration, so the antd cell rebuilds the composite with it.
const meta = {
    title: "@agenta/ui/Presentational/Layout/ModalContentLayout",
    component: ModalContentLayout,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A modal-body layout: picker (left) + content (right) via SplitPanelLayout, with an optional bordered footer. Antd-free — the only migrated part is SplitPanelLayout's vertical divider.\n\n**Used in:** 1 place — the selection modal shell (`@agenta/ui` `components/selection/SelectionModalShell.tsx`), which backs the entity selector modal.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const Picker = () => <div className="text-xs text-colorText">Testset picker</div>
const Content = () => <div className="text-xs text-colorText">Testcase preview table</div>
const Footer = () => (
    <>
        <Button variant="ghost">Cancel</Button>
        <Button>Confirm</Button>
    </>
)

// `data-vrt-subject` marks the crop box: the composite is plain <div>/<section>, so the generic
// subject list would otherwise pick a footer <button>.
const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[9rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            <div className="h-[200px] w-[430px] overflow-hidden" data-vrt-subject>
                {a}
            </div>
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div className="h-[200px] w-[430px] overflow-hidden" data-vrt-subject>
                {s}
            </div>
        </div>
    </div>
)

// Pre-migration composite: ModalContentLayout's own classes (unchanged) around the OLD
// SplitPanelLayout body (antd `Divider orientation="vertical"`) and PanelFooter's classes
// (`border-0 border-t border-solid` — mirrors the fix applied to PanelFooter, so the footer rule
// is now visible in both halves; under preflight:false a bare `border-t` drew nothing, and
// `border-0` is required first so the default border-width does not leak onto the other sides).
// Footer children come from the call site, so both halves get the same @agenta/ui Buttons.
const AntdModalContentLayout = ({withFooter = true}: {withFooter?: boolean}) => (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
        <section className="flex grow min-h-0 overflow-hidden flex-1">
            <div
                className="flex flex-col min-h-0 h-full overflow-hidden gap-4 p-4"
                style={{width: 200, minWidth: 200, maxWidth: 200}}
            >
                <Picker />
            </div>
            <AntDivider orientation="vertical" className="m-0 h-full" />
            <div className="flex flex-col w-full h-full grow min-h-0 overflow-hidden gap-4 p-4">
                <Content />
            </div>
        </section>
        {withFooter ? (
            <div className="border-0 border-t border-solid flex-shrink-0 flex items-center p-4 gap-2 border-zinc-2 justify-between">
                <Footer />
            </div>
        ) : null}
    </div>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[1020px] flex-col">
            <Row
                label="picker + content + footer"
                a={<AntdModalContentLayout />}
                s={
                    <ModalContentLayout
                        pickerWidth={200}
                        picker={<Picker />}
                        content={<Content />}
                        footer={<Footer />}
                    />
                }
            />
            <Row
                label="no footer"
                a={<AntdModalContentLayout withFooter={false} />}
                s={
                    <ModalContentLayout
                        pickerWidth={200}
                        picker={<Picker />}
                        content={<Content />}
                    />
                }
            />
        </div>
    ),
}
