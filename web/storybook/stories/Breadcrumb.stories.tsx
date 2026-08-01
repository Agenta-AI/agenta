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
import {Breadcrumb as AntBreadcrumb} from "antd"

// Phase-0 parity story: the REAL antd Breadcrumb behind the app theme, side by side with the
// @agenta/ui re-skin. antd `items={[{title, href}]}` + optional `separator` maps to the
// composed <Breadcrumb><BreadcrumbList>…</BreadcrumbList></Breadcrumb> parts.
//
// Each agenta <Breadcrumb> gets a DISTINCT aria-label: the a11y audit scopes to the agenta
// cells, so several navs all named "breadcrumb" would trip axe's landmark-unique. The
// component default stays "breadcrumb" (one breadcrumb per real page); the story overrides it.
const meta = {
    title: "@agenta/ui/Primitives/Display/Breadcrumb",
    component: AntBreadcrumb,
    subcomponents: {
        "Breadcrumb (@agenta/ui)": Breadcrumb,
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
                    "antd `Breadcrumb` (interactive reference) shown beside the composed `@agenta/ui` Breadcrumb parts that replace it. See the subcomponent tables below for the agenta props.\n\n**Used in:** indirectly only. No app file imports these parts; the sole consumer is `@agenta/ui` `components/selection/Breadcrumb.tsx`, which the entity picker renders as its breadcrumb variant (`@agenta/entity-ui` `UnifiedEntityPicker/variants/BreadcrumbVariant.tsx`). The layout breadcrumb (`oss/src/components/Layout/assets/Breadcrumbs.tsx`) is still antd.",
            },
        },
    },
} satisfies Meta<typeof AntBreadcrumb>

export default meta
type Story = StoryObj<typeof meta>

// antd has no ellipsis primitive — `{title:"..."}` is just literal text. BreadcrumbEllipsis is
// the shadcn affordance (a MoreHorizontal icon). To compare like-for-like, the antd cell renders
// <BreadcrumbEllipsis/> as its title node (antd accepts any ReactNode), so the VRT proves the
// part renders identically whether wrapped by antd's crumb or the agenta list (and it avoids a
// lucide import the storybook package doesn't declare).

// antd's `-item a` pairs `padding: 0 4px` with `margin-inline: -4px` (they cancel), so only the
// hover pill is a real deviation; the call-site's extra `!p-0 !h-auto` breaks that pair.
const LINK = "hover:!bg-transparent"

// `.grid` Row: [label | antd cell | agenta cell] with "antd"/"agenta" captions.
const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[14rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            {a}
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            {s}
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[960px] flex-col">
            <Row
                label="links + current"
                a={
                    <AntBreadcrumb
                        items={[
                            {
                                title: (
                                    <a href="#home" className={LINK}>
                                        Home
                                    </a>
                                ),
                            },
                            {
                                title: (
                                    <a href="#apps" className={LINK}>
                                        Apps
                                    </a>
                                ),
                            },
                            {title: "Details"},
                        ]}
                    />
                }
                s={
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
                }
            />
            <Row
                label="two crumbs"
                a={
                    <AntBreadcrumb
                        items={[
                            {
                                title: (
                                    <a href="#home" className={LINK}>
                                        Home
                                    </a>
                                ),
                            },
                            {title: "Apps"},
                        ]}
                    />
                }
                s={
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
                }
            />
            <Row
                label="custom separator '>'"
                a={
                    <AntBreadcrumb
                        separator=">"
                        items={[
                            {
                                title: (
                                    <a href="#home" className={LINK}>
                                        Home
                                    </a>
                                ),
                            },
                            {
                                title: (
                                    <a href="#apps" className={LINK}>
                                        Apps
                                    </a>
                                ),
                            },
                            {title: "Details"},
                        ]}
                    />
                }
                s={
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
                }
            />
            <Row
                label="ellipsis (collapsed)"
                a={
                    <AntBreadcrumb
                        items={[
                            {
                                title: (
                                    <a href="#home" className={LINK}>
                                        Home
                                    </a>
                                ),
                            },
                            {title: <BreadcrumbEllipsis />},
                            {title: "Details"},
                        ]}
                    />
                }
                s={
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
                }
            />
        </div>
    ),
}

// Hover: antd linkHoverColor = colorText. antd's hover is runtime-injected cssinjs, so the
// pseudo addon can't always force it — confirm hover colour with getComputedStyle (see README).
export const InteractionStates: Story = {
    render: () => (
        <div className="flex max-w-[960px] flex-col">
            <div className="grid grid-cols-[14rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
                <div className="text-xs text-colorTextSecondary">link · hover (→ colorText)</div>
                <div className="pseudo-hover-all">
                    <span className="text-[10px] text-colorTextSecondary">antd</span>
                    <AntBreadcrumb
                        items={[
                            {
                                title: (
                                    <a href="#home" className={LINK}>
                                        Home
                                    </a>
                                ),
                            },
                            {title: "Details"},
                        ]}
                    />
                </div>
                <div className="pseudo-hover-all">
                    <span className="text-[10px] text-colorTextSecondary">agenta</span>
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
            </div>
        </div>
    ),
}
