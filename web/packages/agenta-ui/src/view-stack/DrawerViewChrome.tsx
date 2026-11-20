import {createContext, useContext} from "react"

import {useT} from "@agenta/i18n"
import viewStackCatalog from "@agenta/i18n/catalogs/ui.viewStack"
import {CaretRight, X} from "@phosphor-icons/react"

import {Button} from "../components/ui/button"
import {cn} from "../components/ui/utils"

import type {ViewChromeProps} from "./types"
import {ViewFormActions} from "./ViewFormActions"

/** Set by `ViewDrawerHost`: the drawer's guarded close. */
export const DrawerCloseContext = createContext<(() => void) | null>(null)

/**
 * The chrome of a container that keeps a drawer: the breadcrumb and Close at the top, the view
 * edge to edge, and the view's action row at the bottom.
 */
export const DrawerViewChrome = ({
    crumbs,
    apply,
    readOnly,
    form,
    footerStartRef,
    onBack,
    onCancel,
    onSave,
    children,
}: ViewChromeProps) => {
    const t = useT(viewStackCatalog)
    const close = useContext(DrawerCloseContext)
    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex h-12 shrink-0 items-center gap-1 border-0 border-b border-solid border-colorBorderSecondary px-3">
                <nav className="flex min-w-0 flex-1 items-center gap-1 text-sm">
                    {crumbs.map((crumb, index) => (
                        <span key={index} className="flex min-w-0 items-center gap-1">
                            {index > 0 ? (
                                <CaretRight size={12} className="shrink-0 text-colorTextTertiary" />
                            ) : null}
                            {crumb.onSelect ? (
                                <button
                                    type="button"
                                    title={crumb.title}
                                    className="truncate text-colorTextSecondary hover:text-colorText"
                                    onClick={crumb.onSelect}
                                >
                                    {crumb.title}
                                </button>
                            ) : (
                                <span
                                    title={crumb.title}
                                    className={cn(
                                        "truncate",
                                        index === crumbs.length - 1 && "font-medium text-colorText",
                                    )}
                                >
                                    {crumb.title}
                                </span>
                            )}
                        </span>
                    ))}
                </nav>
                {close ? (
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("ui.viewStack.close")}
                        onClick={close}
                    >
                        <X size={16} />
                    </Button>
                ) : null}
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
            {readOnly ? null : (
                <div className="shrink-0 border-0 border-t border-solid border-colorBorderSecondary px-4 py-3">
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
