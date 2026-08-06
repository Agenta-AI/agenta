import {Tabs, TabsList, TabsTrigger, TabsContent} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Tabs as AntTabs} from "antd"

// Phase-0 parity story: the REAL antd Tabs (default LINE type) behind the app theme, side by
// side with the @agenta/ui re-skin. antd `items={[{key,label,children,disabled}]}` + `activeKey`/
// `onChange` maps to <Tabs value onValueChange> + <TabsList><TabsTrigger>/<TabsContent>.
const meta = {
    title: "@agenta/ui/Primitives/Display/Tabs",
    component: AntTabs,
    subcomponents: {"Tabs (@agenta/ui)": Tabs, TabsList, TabsTrigger, TabsContent},
    parameters: {
        docs: {
            description: {
                component:
                    "antd `Tabs` (interactive reference) shown beside the `@agenta/ui` Tabs (Radix) that replace it. See the subcomponent tables below for the agenta props.\n\n**Used in:** 3 places — `PageLayout`, the entity selector modal, and the entity picker popover-cascader variant.",
            },
        },
    },
} satisfies Meta<typeof AntTabs>

export default meta
type Story = StoryObj<typeof meta>

const antItems = (opts?: {disableThird?: boolean}) => [
    {key: "1", label: "Tab One", children: <div className="text-field-md">Content one</div>},
    {key: "2", label: "Tab Two", children: <div className="text-field-md">Content two</div>},
    {
        key: "3",
        label: "Tab Three",
        disabled: opts?.disableThird,
        children: <div className="text-field-md">Content three</div>,
    },
]

const Shad = ({defaultValue, disableThird}: {defaultValue: string; disableThird?: boolean}) => (
    <Tabs defaultValue={defaultValue}>
        <TabsList>
            <TabsTrigger value="1">Tab One</TabsTrigger>
            <TabsTrigger value="2">Tab Two</TabsTrigger>
            <TabsTrigger value="3" disabled={disableThird}>
                Tab Three
            </TabsTrigger>
        </TabsList>
        <TabsContent value="1" className="text-field-md">
            Content one
        </TabsContent>
        <TabsContent value="2" className="text-field-md">
            Content two
        </TabsContent>
        <TabsContent value="3" className="text-field-md">
            Content three
        </TabsContent>
    </Tabs>
)

// `.grid` Row: [label | antd cell | agenta cell]. The VRT pairs the tab bar (list + triggers)
// in each cell so the ink bar + active/inactive colours are compared; content sits below.
const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            {/* data-vrt-subject: tabs render a nav + many triggers — crop the whole widget */}
            <div data-vrt-subject>{a}</div>
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div data-vrt-subject>{s}</div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[960px] flex-col">
            <Row
                label="tab 1 active (default)"
                a={<AntTabs defaultActiveKey="1" items={antItems()} />}
                s={<Shad defaultValue="1" />}
            />
            <Row
                label="tab 2 active"
                a={<AntTabs defaultActiveKey="2" items={antItems()} />}
                s={<Shad defaultValue="2" />}
            />
            <Row
                label="disabled tab"
                a={<AntTabs defaultActiveKey="1" items={antItems({disableThird: true})} />}
                s={<Shad defaultValue="1" disableThird />}
            />
        </div>
    ),
}

// Interaction states rendered STATICALLY via storybook-addon-pseudo-states: each cell is
// wrapped in `pseudo-<state>-all`, which forces the pseudo-class on the trigger inside — so
// hover/focus-visible are measurable with getComputedStyle, no cursor/keyboard, forced
// identically on antd and agenta. antd's hover is runtime-injected cssinjs, so the pseudo
// addon can't always force it — confirm hover colour with measureForcedStates() (see README).
const StateRow = ({
    label,
    pseudo,
    antd,
    shad,
}: {
    label: string
    pseudo: string
    antd: React.ReactNode
    shad: React.ReactNode
}) => (
    <div className="grid grid-cols-[14rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className={`${pseudo}`} data-side="antd">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            <div data-vrt-subject>{antd}</div>
        </div>
        <div className={`${pseudo}`} data-side="agenta">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div data-vrt-subject>{shad}</div>
        </div>
    </div>
)

export const InteractionStates: Story = {
    render: () => (
        <div className="flex max-w-[960px] flex-col">
            <StateRow
                label="tab · hover (inactive → colorPrimaryHover)"
                pseudo="pseudo-hover-all"
                antd={<AntTabs defaultActiveKey="1" items={antItems()} />}
                shad={<Shad defaultValue="1" />}
            />
            <StateRow
                label="tab · active (selected + ink bar)"
                pseudo=""
                antd={<AntTabs defaultActiveKey="1" items={antItems()} />}
                shad={<Shad defaultValue="1" />}
            />
            <StateRow
                label="tab · focus-visible (antd gates on .ant-tabs-tab-focus — not reproduced)"
                pseudo="pseudo-focus-visible-all"
                antd={<AntTabs defaultActiveKey="1" items={antItems()} />}
                shad={<Shad defaultValue="1" />}
            />
            <StateRow
                label="tab · disabled"
                pseudo=""
                antd={<AntTabs defaultActiveKey="1" items={antItems({disableThird: true})} />}
                shad={<Shad defaultValue="1" disableThird />}
            />
        </div>
    ),
}
