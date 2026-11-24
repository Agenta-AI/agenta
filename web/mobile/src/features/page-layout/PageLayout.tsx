import type {CSSProperties, ReactNode, RefObject, UIEventHandler} from "react"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {AppShell} from "../nav/AppShell"

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
    /** The page title: the h1 and the browser tab. */
    title: string
    /** One line under the title. */
    description?: ReactNode
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
    description,
    actions,
    width = "lg",
    pane,
    header: headerOverride,
    bodyClassName,
    scrollRef,
    onScroll,
    scrollStyle,
    children,
}: PageLayoutProps) => {
    const expanded = useIsExpandedWindow()

    const header = headerOverride ?? (
        <>
            <PageCompactBar
                workspaceId={workspaceId}
                projectId={projectId}
                actions={expanded ? undefined : actions}
            />
            <div className={`${PAGE_TITLE_BLOCK} ${PAGE_GUTTERS}`}>
                <div className={pageColumn(width)}>
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
            <PageTitle title={title} />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <div className="flex h-full min-w-0">
                    <div className="min-w-0 flex-1">
                        <ScreenScaffold
                            header={header}
                            scrollRef={scrollRef}
                            onScroll={onScroll}
                            scrollStyle={scrollStyle}
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
