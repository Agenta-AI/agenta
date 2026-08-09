import type {ElementType, ReactNode} from "react"

import {pageGutterClass} from "./pageWidth"
import {Tabs, TabsList, TabsTrigger} from "./ui/tabs"
import {cn} from "./ui/utils"

/** One header tab. Loose enough that an antd `TabsProps["items"]` entry is assignable. */
interface PageLayoutTabItem {
    key?: string
    label?: ReactNode
}

/**
 * Minimal header tab config. A local type (no antd dependency) that an antd `TabsProps`
 * object stays structurally assignable to — only `items` / `activeKey` / `defaultActiveKey`
 * / `onChange` are read, and translated onto the `@agenta/ui` (Radix) `Tabs`.
 */
interface HeaderTabsConfig {
    items?: PageLayoutTabItem[]
    activeKey?: string
    defaultActiveKey?: string
    onChange?: (key: string) => void
}

export interface PageLayoutProps {
    title?: ReactNode
    titleLevel?: 1 | 2 | 3 | 4 | 5
    headerTabs?: ReactNode
    /** Header tab bar. Local config type (no runtime/type antd). */
    headerTabsProps?: HeaderTabsConfig
    children: ReactNode
    className?: string
    headerClassName?: string
}

const PageLayout = ({
    title,
    titleLevel = 3,
    headerTabs,
    headerTabsProps,
    children,
    className,
    headerClassName,
}: PageLayoutProps) => {
    const titleText = typeof title === "string" || typeof title === "number" ? String(title) : ""
    const HeadingTag = `h${titleLevel}` as ElementType

    const headerTabsContent = headerTabsProps?.items?.length ? (
        // Header tab BAR only (no content panels — the page body is `children`). The header
        // tabs are 14px/medium (antd default here overrode the 12px control size), so re-apply
        // that on the triggers; the sliding ink bar + states come from the primitive.
        <Tabs
            value={headerTabsProps.activeKey as string | undefined}
            defaultValue={headerTabsProps.defaultActiveKey as string | undefined}
            onValueChange={(value) => headerTabsProps.onChange?.(value)}
            // mb-0 replaces the old `[&_.ant-tabs-nav]:mb-0`: a bar-only tab list must not keep
            // the 16px gap the primitive leaves for panels, or it rides 8px high in the header.
            className="[&_[data-slot=tabs-list]]:mb-0 [&_[data-slot=tabs-trigger]]:text-sm [&_[data-slot=tabs-trigger]]:font-medium"
        >
            <TabsList>
                {headerTabsProps.items.map((item) => (
                    <TabsTrigger key={item?.key} value={String(item?.key ?? "")}>
                        {item && "label" in item ? item.label : null}
                    </TabsTrigger>
                ))}
            </TabsList>
        </Tabs>
    ) : (
        headerTabs
    )

    return (
        <div
            className={cn(
                "flex w-full flex-col gap-4 self-stretch min-h-full",
                pageGutterClass,
                className,
            )}
        >
            {title ? (
                <div
                    className={cn(
                        // shrink-0 keeps the header at exactly h-11 in the flex column.
                        // Without it, a title-only header (little intrinsic content) gets
                        // compressed below 44px while a tabbed header resists shrinking
                        // (tabs have a taller min-content height) — producing different
                        // header heights and a layout shift when navigating between
                        // tabbed and non-tabbed full-screen table pages.
                        "flex shrink-0 items-center justify-between gap-3 h-11",
                        headerClassName,
                    )}
                >
                    <div className="min-w-0 flex-1">
                        {/* antd Title replacement: a real heading sized off antd's own heading
                            tokens so it flips/scales with the theme; `m-0` kills the UA margin
                            (preflight is off). Weight is fontWeightStrong — antd's own Title rule
                            won over the prior `font-medium` className, so 600 IS the baseline. */}
                        <HeadingTag
                            className="m-0 truncate"
                            style={{
                                fontSize: `var(--ant-font-size-heading-${titleLevel})`,
                                lineHeight: `var(--ant-line-height-heading-${titleLevel})`,
                                fontWeight: "var(--ant-font-weight-strong)",
                            }}
                            title={titleText || undefined}
                        >
                            {title}
                        </HeadingTag>
                    </div>
                    {headerTabsContent ? (
                        <div className="flex items-center justify-end">{headerTabsContent}</div>
                    ) : null}
                </div>
            ) : null}
            {children}
        </div>
    )
}

export default PageLayout
