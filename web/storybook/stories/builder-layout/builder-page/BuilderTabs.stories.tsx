import {useState} from "react"

import type {Meta, StoryObj} from "@storybook/nextjs"

import {
    builderTabKey,
    type BuilderTab,
} from "../../../../mobile/src/features/builder-page/builderTabs"
import {BuilderTabStrip} from "../../../../mobile/src/features/builder-page/BuilderTabStrip"
import {B03_ACTIVE, B03_TABS} from "../../../fixtures/builderLayout/builder-page"

const noop = () => undefined

/** The tab strip at the top of the builder pane (B03), at the pane width of the canvas. */
const TabStripFrame = ({tabs, initialActive}: {tabs: BuilderTab[]; initialActive: string}) => {
    const [active, setActive] = useState<string | null>(initialActive)
    const [open, setOpen] = useState(tabs)
    return (
        <div data-testid="builder-tabs-story" className="w-[600px] bg-background">
            <div className="flex h-12 items-center border-0 border-b border-solid border-colorBorderSecondary px-2">
                <BuilderTabStrip
                    tabs={open}
                    active={active}
                    label={(tab) => tab.name}
                    onActivate={setActive}
                    onClose={(key) => {
                        setOpen((current) => current.filter((tab) => builderTabKey(tab) !== key))
                        if (key === active) setActive(null)
                    }}
                    onOpenAgent={noop}
                />
            </div>
        </div>
    )
}

const meta = {
    title: "BuilderLayout/builder-page/Builder tabs",
    component: TabStripFrame,
    parameters: {layout: "centered"},
    args: {tabs: B03_TABS, initialActive: B03_ACTIVE},
} satisfies Meta<typeof TabStripFrame>

export default meta
type Story = StoryObj<typeof meta>

/** B03: three tabs, "2 more" and "+"; "Email writer" is active. */
export const PaneTabs: Story = {}

/** A tab the builder changed while another tab was active shows a dot. */
export const ChangedTab: Story = {
    args: {
        tabs: B03_TABS.map((tab) => (tab.name === "Lead finder" ? {...tab, dot: true} : tab)),
    },
}
