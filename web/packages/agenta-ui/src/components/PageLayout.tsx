import type {CSSProperties, ElementType, ReactNode} from "react"

import {Tabs, TabsList, TabsTrigger} from "@agenta/primitive-ui/components/tabs"
import clsx from "clsx"

export interface HeaderTabItem {
    key: string
    label: ReactNode
    disabled?: boolean
}

export interface HeaderTabsProps {
    items: HeaderTabItem[]
    activeKey: string
    onChange: (key: string) => void
    className?: string
    indicatorColor?: string
}

export interface PageLayoutProps {
    title?: ReactNode
    titleLevel?: 1 | 2 | 3 | 4 | 5
    headerTabs?: ReactNode
    headerTabsProps?: HeaderTabsProps
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
    const TitleTag = `h${titleLevel}` as ElementType
    const titleClass = {
        1: "text-2xl font-semibold leading-tight",
        2: "text-xl font-semibold leading-tight",
        3: "text-lg font-semibold leading-snug",
        4: "text-base font-semibold leading-snug",
        5: "text-sm font-semibold leading-normal",
    }[titleLevel]
    const titleText = typeof title === "string" || typeof title === "number" ? String(title) : ""
    const headerTabsContent = headerTabsProps ? (
        <Tabs
            value={headerTabsProps.activeKey}
            onValueChange={(key) => {
                if (key !== null) headerTabsProps.onChange(String(key))
            }}
            className={clsx("gap-0", headerTabsProps.className)}
            style={
                headerTabsProps.indicatorColor
                    ? ({
                          "--tab-indicator-color": headerTabsProps.indicatorColor,
                      } as CSSProperties)
                    : undefined
            }
        >
            <TabsList variant="line" className="min-w-[320px]">
                {headerTabsProps.items.map((item) => (
                    <TabsTrigger
                        key={item.key}
                        value={item.key}
                        disabled={item.disabled}
                        data-tab-key={item.key}
                        className="gap-2 px-3 text-[14px] leading-[1.5714285714] data-active:after:bg-[var(--tab-indicator-color,var(--foreground))]"
                    >
                        {item.label}
                    </TabsTrigger>
                ))}
            </TabsList>
        </Tabs>
    ) : (
        headerTabs
    )

    return (
        <div className={clsx("flex w-full flex-col gap-4 p-4 self-stretch min-h-full", className)}>
            {title ? (
                <div
                    className={clsx(
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
                        <TitleTag
                            className={clsx("!m-0 truncate", titleClass)}
                            title={titleText || undefined}
                        >
                            {title}
                        </TitleTag>
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
