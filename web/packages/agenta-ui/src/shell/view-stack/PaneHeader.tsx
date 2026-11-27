import {createContext, useContext, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import viewStackCatalog from "@agenta/i18n/catalogs/ui.viewStack"
import {ArrowsOutSimple, X} from "@phosphor-icons/react"
import {createPortal} from "react-dom"

import {BackLink} from "../../composed/controls/back-link"
import {SimpleTooltip} from "../../composed/feedback/simple-tooltip"
import {cn} from "../../foundation/utils/cn"
import {Button, ButtonSizeContext} from "../../primitives/button"
import {SheetFooter} from "../../primitives/sheet"

// While the open view (stack or tab) shows its own ItemViewTitle; Tailwind needs whole names.
const ITEM_OPEN_HIDDEN =
    "[[data-pane]:has([data-view-top]_[data-item-view-title])_&]:hidden [[data-pane]:has([data-pane-view]_[data-item-view-title])_&]:hidden"
const ITEM_OPEN_BACK =
    "[[data-pane]:has([data-view-top]_[data-item-view-title])_&]:max-w-full [[data-pane]:has([data-view-top]_[data-item-view-title])_&]:text-foreground [[data-pane]:has([data-pane-view]_[data-item-view-title])_&]:max-w-full [[data-pane]:has([data-pane-view]_[data-item-view-title])_&]:text-foreground"

export interface PaneHeaderProps {
    /** The way up, named for where it leads ("← Agent"). */
    back?: {title: string; onBack: () => void} | null
    /** The open view's name, after the back link ("← Agent / Add MCP server"). */
    title?: string
    /** In place of back and title: the pane's tab row. */
    children?: ReactNode
    /** Before Widen and Close. */
    actions?: ReactNode
    onWiden?: {wide: boolean; onToggle: () => void}
    onClose?: () => void
    className?: string
}

/** The right pane's 48px header: back and title (or the tabs) on the 16px line, then Widen and Close at one place. */
export const PaneHeader = ({
    back,
    title,
    children,
    actions,
    onWiden,
    onClose,
    className,
}: PaneHeaderProps) => {
    const t = useT(viewStackCatalog)
    return (
        <div
            data-pane-header=""
            className={cn(
                "flex h-12 shrink-0 items-center gap-2 border-0 border-b border-solid border-border-muted pl-4 pr-2.5",
                className,
            )}
        >
            <div className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch">
                {children ?? (
                    <>
                        {back ? (
                            <BackLink
                                size="bar"
                                title={back.title}
                                onClick={back.onBack}
                                className={cn(
                                    "max-w-full shrink",
                                    title && ["max-w-1/2 text-muted-foreground", ITEM_OPEN_BACK],
                                )}
                            >
                                <span className="truncate">{back.title}</span>
                            </BackLink>
                        ) : null}
                        {title ? (
                            // A view that names its item itself (ItemViewTitle) keeps the header back-only.
                            <span
                                data-pane-title=""
                                className={cn(
                                    "flex min-w-0 items-center gap-1.5",
                                    ITEM_OPEN_HIDDEN,
                                )}
                            >
                                {back ? (
                                    <span aria-hidden className="text-label text-muted-foreground">
                                        /
                                    </span>
                                ) : null}
                                <span className="truncate text-label text-foreground">{title}</span>
                            </span>
                        ) : null}
                    </>
                )}
            </div>
            {actions}
            {onWiden ? (
                <SimpleTooltip title={t("ui.viewStack.widen")}>
                    <Button
                        variant="ghost"
                        size="icon-compact"
                        aria-label={t("ui.viewStack.widen")}
                        aria-pressed={onWiden.wide}
                        onClick={onWiden.onToggle}
                    >
                        <ArrowsOutSimple size={16} />
                    </Button>
                </SimpleTooltip>
            ) : null}
            {onClose ? (
                <SimpleTooltip title={t("ui.viewStack.close")}>
                    <Button
                        variant="ghost"
                        size="icon-compact"
                        aria-label={t("ui.viewStack.close")}
                        onClick={onClose}
                    >
                        <X size={16} />
                    </Button>
                </SimpleTooltip>
            ) : null}
        </div>
    )
}

/** Where a pane chrome draws the action row of a view that is not in a view stack. */
export const PaneFooterSlotContext = createContext<HTMLElement | null>(null)

/** The pane's action row band; empty, it takes no room. */
export const PANE_FOOTER_CLASS =
    "flex shrink-0 items-center justify-end gap-2 bg-muted px-4 py-2.5 empty:hidden"

/** A view's action row: in a pane chrome, the chrome's row with compact buttons; elsewhere a band pinned under the body. */
export const PaneFooter = ({children}: {children: ReactNode}) => {
    const slot = useContext(PaneFooterSlotContext)
    if (slot)
        return createPortal(
            <ButtonSizeContext.Provider value="compact">{children}</ButtonSizeContext.Provider>,
            slot,
        )
    return (
        <div className="sticky -bottom-4 z-10 -mx-[var(--panel-bleed-x,1rem)] -mb-4 mt-auto rounded-b-[inherit] bg-background">
            <SheetFooter>{children}</SheetFooter>
        </div>
    )
}
