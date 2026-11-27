import {createContext, useContext} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import viewStackCatalog from "@agenta/i18n/catalogs/ui.viewStack"
import {ArrowLeft, CaretRight, X} from "@phosphor-icons/react"

import {SimpleTooltip} from "../components/composed/simple-tooltip"
import {Button} from "../components/ui/button"
import {cn} from "../components/ui/utils"

import type {ViewChromeProps} from "./types"
import {ViewFormActions} from "./ViewFormActions"

/** Set by `ViewDrawerHost`: the drawer's guarded close. */
export const DrawerCloseContext = createContext<(() => void) | null>(null)

/** Set by `ViewDrawerHost`: no header row; Close sits at the top right of the view itself. */
export const DrawerBareContext = createContext(false)

/** Set by `ViewDrawerHost` in a dialog: the header row has no rule under it. */
export const DrawerDialogContext = createContext(false)

/**
 * The chrome of a container that keeps a drawer: the breadcrumb and Close at the top, the view
 * edge to edge, and the view's action row at the bottom.
 */
export const DrawerViewChrome = ({
    crumbs,
    apply,
    hideActionRow,
    showBack,
    form,
    footerStartRef,
    onBack,
    onCancel,
    onSave,
    children,
}: ViewChromeProps) => {
    const t = useT(viewStackCatalog, commonCatalog)
    const close = useContext(DrawerCloseContext)
    const bare = useContext(DrawerBareContext) && !showBack
    const inDialog = useContext(DrawerDialogContext)
    const closeButton = close ? (
        <SimpleTooltip title={t("ui.viewStack.close")}>
            <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("ui.viewStack.close")}
                onClick={close}
            >
                <X size={16} />
            </Button>
        </SimpleTooltip>
    ) : null
    return (
        <div className="relative flex h-full min-h-0 flex-col">
            {bare ? (
                <div className="absolute right-3 top-4 z-10">{closeButton}</div>
            ) : (
                <div
                    className={cn(
                        "flex h-12 shrink-0 items-center gap-1 px-3",
                        !inDialog && "border-0 border-b border-solid border-border-muted",
                    )}
                >
                    {showBack ? (
                        <SimpleTooltip title={t("common.back")}>
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={t("common.back")}
                                onClick={onBack}
                            >
                                <ArrowLeft size={16} />
                            </Button>
                        </SimpleTooltip>
                    ) : null}
                    <nav className="flex min-w-0 flex-1 items-center gap-1 text-label">
                        {crumbs.map((crumb, index) => (
                            <span key={index} className="flex min-w-0 items-center gap-1">
                                {index > 0 ? (
                                    <CaretRight
                                        size={12}
                                        className="shrink-0 text-muted-foreground"
                                    />
                                ) : null}
                                {crumb.onSelect ? (
                                    <button
                                        type="button"
                                        title={crumb.title}
                                        className="truncate text-muted-foreground hover:text-foreground"
                                        onClick={crumb.onSelect}
                                    >
                                        {crumb.title}
                                    </button>
                                ) : (
                                    <span
                                        title={crumb.title}
                                        className={cn(
                                            "truncate",
                                            index === crumbs.length - 1 &&
                                                "font-medium text-foreground",
                                        )}
                                    >
                                        {crumb.title}
                                    </span>
                                )}
                            </span>
                        ))}
                    </nav>
                    {closeButton}
                </div>
            )}
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
            {hideActionRow ? null : (
                <div
                    className={cn(
                        "shrink-0 border-0 border-t border-solid border-border-muted px-4 py-3",
                        // An instant view with nothing in its start shows no footer at all.
                        apply === "immediate" && "[&:has([data-footer-start]:empty)]:hidden",
                    )}
                >
                    <ViewFormActions
                        apply={apply}
                        form={form}
                        onBack={onBack}
                        onCancel={onCancel}
                        onSave={onSave}
                        startRef={footerStartRef}
                    />
                </div>
            )}
        </div>
    )
}
