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
    /** An optional toolbar (`PageToolbar`, or any row): pinned under the title, outside the scroll. */
    toolbar?: ReactNode
    /** The content cap (LAYOUT-02). Lists `lg` (the default), item pages and Home `md`, forms `sm`. */
    width?: PageWidth
    scrollRef?: RefObject<HTMLDivElement | null>
    onScroll?: UIEventHandler<HTMLDivElement>
    scrollStyle?: CSSProperties
    /** Extra classes on the scroller, e.g. a scroll-edge fade. */
    scrollClassName?: string
    children: ReactNode
}

/**
 * The general page (DESIGN.md, "Layout and windows"): the sidebar, the content column and the
 * right pane (the shell's slot: render `<RightPane>` from `@agenta/ui/ui` anywhere), with the same
 * top on every page (LAYOUT-03). A page whose top or column is its own (a workbench page, an
 * agent's pages) does not use it: it builds on `AppShell` and `ScreenScaffold` directly.
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
    toolbar,
    width = "lg",
    scrollRef,
    onScroll,
    scrollStyle,
    scrollClassName,
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
            <div className={`${PAGE_TITLE_BLOCK} ${PAGE_GUTTERS}`}>
                <div className={pageColumn(width)}>
                    {back && expanded ? <PageBackControl back={back} className="mb-2" /> : null}
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
                    {toolbar ? <div className="mt-6">{toolbar}</div> : null}
                </div>
            </div>
        </>
    )

    return (
        <>
            <PageTitle title={documentTitle ?? title} />
            <AppShell workspaceId={workspaceId} projectId={projectId} scope={scope}>
                <ScreenScaffold
                    header={header}
                    scrollRef={scrollRef}
                    onScroll={onScroll}
                    scrollStyle={scrollStyle}
                    scrollClassName={scrollClassName}
                >
                    <div className={PAGE_GUTTERS}>
                        <div
                            className={`${pageColumn(width)} ${toolbar ? PAGE_BODY_UNDER_TOOLBAR : PAGE_BODY}`}
                        >
                            {children}
                        </div>
                    </div>
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
