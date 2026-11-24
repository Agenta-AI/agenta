import type {CSSProperties, ReactNode, RefObject, UIEventHandler} from "react"

import type {SidebarScope} from "@agenta/navigation"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {AppShell} from "../nav/AppShell"

import {PageBackBar, type PageBack} from "./PageBackBar"
import {PageBackLink} from "./PageBackLink"
import {PageCompactBar} from "./PageCompactBar"
import {
    PAGE_BODY,
    PAGE_GUTTERS,
    PAGE_TITLE_BLOCK,
    PAGE_TITLE_ROW,
    pageColumn,
    type PageWidth,
} from "./pageFrame"
import {PageRightPane, type PagePane} from "./PageRightPane"
import {useIsExpandedWindow} from "./useIsExpandedWindow"

export interface PageLayoutProps {
    workspaceId: string
    projectId: string
    /** The page title: the h1, and the browser tab unless `documentTitle` names it. */
    title: string
    /** The browser tab's title when it is not the h1 (Settings names the tab, not the section). */
    documentTitle?: string
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
    /** The content cap (LAYOUT-02). Lists `lg` (the default), item pages and Home `md`, forms `sm`. */
    width?: PageWidth
    /** The right pane (LAYOUT-04). */
    pane?: PagePane
    /** Replaces the whole pinned top (bar and title), for a page whose top is its own. */
    header?: ReactNode
    /** Replaces the body's gutters and column, for a page whose column is its own. */
    bodyClassName?: string
    scrollRef?: RefObject<HTMLDivElement | null>
    onScroll?: UIEventHandler<HTMLDivElement>
    scrollStyle?: CSSProperties
    /** Extra classes on the scroller, e.g. a scroll-edge fade. */
    scrollClassName?: string
    children: ReactNode
}

/**
 * The general page (DESIGN.md, "Layout and windows"): the sidebar, the content column and the right
 * pane, with the same top on every page (LAYOUT-03). A workbench page (the session playground, the
 * Builder) does not use it: it draws its own bar across the top and takes the full width.
 *
 * Only the body scrolls; the compact bar and the title block stay pinned above it.
 */
export const PageLayout = ({
    workspaceId,
    projectId,
    title,
    documentTitle,
    scope,
    description,
    back,
    actions,
    width = "lg",
    pane,
    header: headerOverride,
    bodyClassName,
    scrollRef,
    onScroll,
    scrollStyle,
    scrollClassName,
    children,
}: PageLayoutProps) => {
    const expanded = useIsExpandedWindow()

    const header = headerOverride ?? (
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
            <div className={`${PAGE_TITLE_BLOCK} ${PAGE_GUTTERS}`}>
                <div className={pageColumn(width)}>
                    {back && expanded ? <PageBackLink back={back} /> : null}
                    <div className={PAGE_TITLE_ROW}>
                        <h1 className="m-0 min-w-0 flex-1 truncate text-heading text-foreground">
                            {title}
                        </h1>
                        {expanded && actions ? (
                            <div className="flex shrink-0 items-center gap-2">{actions}</div>
                        ) : null}
                    </div>
                    {description ? (
                        <p className="m-0 mt-1 text-body text-muted-foreground">{description}</p>
                    ) : null}
                </div>
            </div>
        </>
    )

    return (
        <>
            <PageTitle title={documentTitle ?? title} />
            <AppShell workspaceId={workspaceId} projectId={projectId} scope={scope}>
                <div className="flex h-full min-w-0">
                    <div className="min-w-0 flex-1">
                        <ScreenScaffold
                            header={header}
                            scrollRef={scrollRef}
                            onScroll={onScroll}
                            scrollStyle={scrollStyle}
                            scrollClassName={scrollClassName}
                        >
                            {bodyClassName ? (
                                <div className={bodyClassName}>{children}</div>
                            ) : (
                                <div className={PAGE_GUTTERS}>
                                    <div className={`${pageColumn(width)} ${PAGE_BODY}`}>
                                        {children}
                                    </div>
                                </div>
                            )}
                        </ScreenScaffold>
                    </div>
                    {pane ? <PageRightPane pane={pane} docked={expanded} /> : null}
                </div>
            </AppShell>
        </>
    )
}
