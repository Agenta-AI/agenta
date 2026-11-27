import {
    Breadcrumb,
    BreadcrumbEllipsis,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

// Each <Breadcrumb> gets a DISTINCT aria-label: several navs all named "breadcrumb" would trip
// axe's landmark-unique. The component default stays "breadcrumb" (one breadcrumb per real page);
// the story overrides it.
const meta = {
    title: "@agenta/ui/Primitives/Display/Breadcrumb",
    component: Breadcrumb,
    subcomponents: {
        BreadcrumbList,
        BreadcrumbItem,
        BreadcrumbLink,
        BreadcrumbPage,
        BreadcrumbSeparator,
        BreadcrumbEllipsis,
    },
    parameters: {
        docs: {
            description: {
                component:
                    "A navigation trail composed from `Breadcrumb` > `BreadcrumbList` > items, links, the current page, separators and an ellipsis for collapsed crumbs. Prop tables for each part are below.\n\n**Used in:** indirectly only. No app file imports these parts; the sole consumer is `@agenta/ui` `components/selection/Breadcrumb.tsx`, which the entity picker renders as its breadcrumb variant (`@agenta/entity-ui` `UnifiedEntityPicker/variants/BreadcrumbVariant.tsx`).",
            },
        },
    },
} satisfies Meta<typeof Breadcrumb>

export default meta
type Story = StoryObj<typeof meta>

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[14rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div>{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[640px] flex-col">
            <Row label="links + current">
                <Breadcrumb aria-label="Breadcrumb: links and current">
                    <BreadcrumbList>
                        <BreadcrumbItem>
                            <BreadcrumbLink href="#home">Home</BreadcrumbLink>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator />
                        <BreadcrumbItem>
                            <BreadcrumbLink href="#apps">Apps</BreadcrumbLink>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator />
                        <BreadcrumbItem>
                            <BreadcrumbPage>Details</BreadcrumbPage>
                        </BreadcrumbItem>
                    </BreadcrumbList>
                </Breadcrumb>
            </Row>
            <Row label="two crumbs">
                <Breadcrumb aria-label="Breadcrumb: two crumbs">
                    <BreadcrumbList>
                        <BreadcrumbItem>
                            <BreadcrumbLink href="#home">Home</BreadcrumbLink>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator />
                        <BreadcrumbItem>
                            <BreadcrumbPage>Apps</BreadcrumbPage>
                        </BreadcrumbItem>
                    </BreadcrumbList>
                </Breadcrumb>
            </Row>
            <Row label="custom separator '>'">
                <Breadcrumb aria-label="Breadcrumb: custom separator">
                    <BreadcrumbList>
                        <BreadcrumbItem>
                            <BreadcrumbLink href="#home">Home</BreadcrumbLink>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator>{">"}</BreadcrumbSeparator>
                        <BreadcrumbItem>
                            <BreadcrumbLink href="#apps">Apps</BreadcrumbLink>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator>{">"}</BreadcrumbSeparator>
                        <BreadcrumbItem>
                            <BreadcrumbPage>Details</BreadcrumbPage>
                        </BreadcrumbItem>
                    </BreadcrumbList>
                </Breadcrumb>
            </Row>
            <Row label="ellipsis (collapsed)">
                <Breadcrumb aria-label="Breadcrumb: collapsed">
                    <BreadcrumbList>
                        <BreadcrumbItem>
                            <BreadcrumbLink href="#home">Home</BreadcrumbLink>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator />
                        <BreadcrumbItem>
                            <BreadcrumbEllipsis />
                        </BreadcrumbItem>
                        <BreadcrumbSeparator />
                        <BreadcrumbItem>
                            <BreadcrumbPage>Details</BreadcrumbPage>
                        </BreadcrumbItem>
                    </BreadcrumbList>
                </Breadcrumb>
            </Row>
        </div>
    ),
}

export const InteractionStates: Story = {
    render: () => (
        <div className="flex max-w-[640px] flex-col">
            <Row label="link · hover">
                <div className="pseudo-hover-all">
                    <Breadcrumb aria-label="Breadcrumb: hover state">
                        <BreadcrumbList>
                            <BreadcrumbItem>
                                <BreadcrumbLink href="#home">Home</BreadcrumbLink>
                            </BreadcrumbItem>
                            <BreadcrumbSeparator />
                            <BreadcrumbItem>
                                <BreadcrumbPage>Details</BreadcrumbPage>
                            </BreadcrumbItem>
                        </BreadcrumbList>
                    </Breadcrumb>
                </div>
            </Row>
        </div>
    ),
}
