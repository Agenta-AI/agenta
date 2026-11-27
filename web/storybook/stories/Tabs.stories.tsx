import {Tabs, TabsList, TabsTrigger, TabsContent} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Primitives/Display/Tabs",
    component: Tabs,
    subcomponents: {TabsList, TabsTrigger, TabsContent},
    parameters: {
        docs: {
            description: {
                component:
                    "The `@agenta/ui` Tabs (Radix): `Tabs` with `value`/`onValueChange`, a `TabsList` of `TabsTrigger`s and a `TabsContent` per tab. See the subcomponent tables below for the part props.\n\n**Used in:** 3 places — `PageLayout`, the entity selector modal, and the entity picker popover-cascader variant.",
            },
        },
    },
} satisfies Meta<typeof Tabs>

export default meta
type Story = StoryObj<typeof meta>

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

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div>{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[640px] flex-col">
            <Row label="tab 1 active (default)">
                <Shad defaultValue="1" />
            </Row>
            <Row label="tab 2 active">
                <Shad defaultValue="2" />
            </Row>
            <Row label="disabled tab">
                <Shad defaultValue="1" disableThird />
            </Row>
        </div>
    ),
}

// Interaction states rendered STATICALLY via storybook-addon-pseudo-states: each cell is
// wrapped in `pseudo-<state>-all`, which forces the pseudo-class on the trigger inside.
const StateRow = ({
    label,
    pseudo,
    children,
}: {
    label: string
    pseudo: string
    children: React.ReactNode
}) => (
    <div className="grid grid-cols-[14rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className={pseudo}>{children}</div>
    </div>
)

export const InteractionStates: Story = {
    render: () => (
        <div className="flex max-w-[640px] flex-col">
            <StateRow label="tab · hover (inactive)" pseudo="pseudo-hover-all">
                <Shad defaultValue="1" />
            </StateRow>
            <StateRow label="tab · active (selected)" pseudo="">
                <Shad defaultValue="1" />
            </StateRow>
            <StateRow label="tab · focus-visible" pseudo="pseudo-focus-visible-all">
                <Shad defaultValue="1" />
            </StateRow>
            <StateRow label="tab · disabled" pseudo="">
                <Shad defaultValue="1" disableThird />
            </StateRow>
        </div>
    ),
}
