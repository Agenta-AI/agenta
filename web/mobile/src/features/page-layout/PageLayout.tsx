import type {CSSProperties, ReactNode, RefObject, UIEventHandler} from "react"

import type {SidebarScope} from "@agenta/navigation"
import {useIsExpandedWindow} from "@agenta/ui/hooks"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {AppShell} from "../nav/AppShell"

import {PageBackBar, type PageBack} from "./PageBackBar"
import {PageBackControl} from "./PageBackControl"
import {PageCompactBar} from "./PageCompactBar"
import {
    PAGE_BODY,
    PAGE_BODY_UNDER_TOOLBAR,
    PAGE_GUTTERS,
    PAGE_TITLE_BLOCK,
    PAGE_TITLE_ROW,
    pageColumn,
    type PageWidth,
} from "./pageFrame"

const SCREEN_FILL = "flex min-h-0 min-w-0 flex-1 flex-col"

export interface PageLayoutProps {
    workspaceId: string
    projectId: string
    /**
     * The page title. Text becomes the h1 and the browser tab; an element (an editable name) draws
     * its own heading, and then `documentTitle` names the tab.
     */
    title: ReactNode
    /** The browser tab's title when it is not the h1 (Settings names the tab, not the section). */
    documentTitle?: string
    /** What the page is about, after the title in the browser tab (an automation's name). */
    documentContext?: string
    /** Replaces the main nav in the sidebar and the drawer (Settings). */
    scope?: SidebarScope
    /** One line under the title. */
    description?: ReactNode
    /**
     * An inside page's parent. Below lg the bar shows Back to it in place of the menu (the COMPACT
     * rule: every page but the top-level ones has Back); on lg a back link sits over the title.
     */
    back?: PageBack
    /** The page actions: in the title row on an expanded window, in the compact bar below it. */
    actions?: ReactNode
    /** An optional toolbar (`PageToolbar`, or any row): pinned under the title, outside the scroll. */
    toolbar?: ReactNode
    /** Extra classes on the title block, e.g. `hidden` while an item's own header shows. */
    headClassName?: string
    /** The content cap (LAYOUT-02). Lists `lg` (the default), item pages and Home `md`, forms `sm`. */
    width?: PageWidth
    scrollRef?: RefObject<HTMLDivElement | null>
    onScroll?: UIEventHandler<HTMLDivElement>
    scrollStyle?: CSSProperties
    /** Extra classes on the scroller, e.g. a scroll-edge fade. */
    scrollClassName?: string
    /** A phone screen in the page: its own header (or none) and a full-bleed body. */
    screen?: {header?: ReactNode}
    children: ReactNode
}

/**
 * The general page (DESIGN.md, "Layout and windows"): the sidebar, the content column and the
 * right pane (the shell's slot: render `<RightPane>` from `@agenta/ui/ui` anywhere), with the same
 * top on every page (LAYOUT-03). A page whose top or column is its own (a workbench page) does not
 * use it: it builds on `AppShell` and `ScreenScaffold` directly.
 *
 * Only the body scrolls; the compact bar and the title block stay pinned above it.
 */
export const PageLayout = ({
    workspaceId,
    projectId,
    title,
    documentTitle,
    documentContext,
    scope,
    description,
    back,
    actions,
    toolbar,
    headClassName,
    width = "lg",
    scrollRef,
    onScroll,
    scrollStyle,
    scrollClassName,
    screen,
    children,
}: PageLayoutProps) => {
    const expanded = useIsExpandedWindow()

    const header = (
        <>
            {back ? (
                <PageBackBar back={back} width={width} actions={expanded ? undefined : actions} />
            ) : (
                <PageCompactBar
                    workspaceId={workspaceId}
                    projectId={projectId}
                    scope={scope}
                    width={width}
                    actions={expanded ? undefined : actions}
                />
            )}
            <div
                className={`${PAGE_TITLE_BLOCK} ${PAGE_GUTTERS}${headClassName ? ` ${headClassName}` : ""}`}
            >
                <div className={pageColumn(width)}>
                    {back && expanded ? <PageBackControl back={back} className="mb-2" /> : null}
                    <div className={PAGE_TITLE_ROW}>
                        {typeof title === "string" ? (
                            <h1 className="m-0 min-w-0 flex-1 truncate text-heading text-foreground">
                                {title}
                            </h1>
                        ) : (
                            <div className="min-w-0 flex-1">{title}</div>
                        )}
                        {expanded && actions ? (
                            <div className="flex shrink-0 items-center gap-2">{actions}</div>
                        ) : null}
                    </div>
                    {typeof description === "string" ? (
                        <p className="m-0 mt-1 text-body text-muted-foreground">{description}</p>
                    ) : (
                        description
                    )}
                    {toolbar ? <div className="mt-6">{toolbar}</div> : null}
                </div>
            </div>
        </>
    )

    return (
        <>
            <PageTitle
                title={documentTitle ?? (typeof title === "string" ? title : undefined)}
                context={documentContext}
            />
            <AppShell workspaceId={workspaceId} projectId={projectId} scope={scope}>
                <ScreenScaffold
                    header={screen ? screen.header : header}
                    scrollRef={scrollRef}
                    onScroll={onScroll}
                    scrollStyle={scrollStyle}
                    scrollClassName={scrollClassName}
                    fill={Boolean(screen)}
                >
                    {/* The same elements in both modes, so the body keeps its state. */}
                    <div className={screen ? SCREEN_FILL : PAGE_GUTTERS}>
                        <div
                            className={
                                screen
                                    ? SCREEN_FILL
                                    : `${pageColumn(width)} ${toolbar ? PAGE_BODY_UNDER_TOOLBAR : PAGE_BODY}`
                            }
                        >
                            {children}
                        </div>
                    </div>
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
