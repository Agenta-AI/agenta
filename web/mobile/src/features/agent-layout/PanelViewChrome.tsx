import {createContext, useContext, useEffect} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {cn} from "@agenta/ui/styles"
import {
    PaneHeader,
    PhoneViewHeader,
    ViewFormActions,
    type ViewChromeProps,
} from "@agenta/ui/view-stack"

/** What the container around the views offers their chrome. */
export interface PanelChromeControls {
    phone: boolean
    /** The container can grow for a wide view; without it there is no widen button. */
    widen?: {wide: boolean; setWide: (wide: boolean) => void}
    /** Closes the container; without it the header has no Close. */
    onClose?: () => void
}

export const PanelChromeContext = createContext<PanelChromeControls>({phone: false})

const noWiden = () => undefined

/**
 * The agent pane's chrome around an open view: `PaneHeader` ("← Parent / View", Widen, Close)
 * in place of the tabs, and the view's action row at the bottom. The container sets which
 * controls it has (`PanelChromeContext`). On a phone the view covers the screen with the phone
 * header (back arrow and title) and 44 px buttons.
 * The view keeps its place in the tree in both, so a resize across the phone width keeps its edits.
 */
export const PanelViewChrome = ({
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
    const t = useT(commonCatalog)
    const {phone, widen, onClose} = useContext(PanelChromeContext)
    const setWide = widen?.setWide ?? noWiden
    // The widen lasts while the views are open: closing them restores the stored width.
    useEffect(() => () => setWide(false), [setWide])
    // A step inside the view goes back to the step before; else up to the view it opened from.
    const parent = crumbs.length > 1 ? crumbs[crumbs.length - 2] : null
    const back = showBack
        ? {title: crumbs[crumbs.length - 1]?.title ?? t("common.back"), onSelect: onBack}
        : parent?.onSelect
          ? {title: parent.title, onSelect: parent.onSelect}
          : null

    return (
        <div data-pane="" className="flex h-full min-h-0 min-w-0 flex-col">
            {phone ? (
                <PhoneViewHeader crumbs={crumbs} onBack={onBack} form={form} />
            ) : (
                <PaneHeader
                    back={back ? {title: back.title, onBack: back.onSelect} : null}
                    title={showBack ? undefined : crumbs[crumbs.length - 1]?.title || undefined}
                    onWiden={
                        widen ? {wide: widen.wide, onToggle: () => setWide(!widen.wide)} : undefined
                    }
                    onClose={onClose}
                />
            )}
            {/* Edge to edge: each view pads itself. */}
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
            {hideActionRow ? null : (
                <div
                    className={cn(
                        "shrink-0 px-4",
                        // A filled band on the desktop, a hairline on a phone.
                        phone
                            ? "border-0 border-t border-solid border-border-muted pb-6 pt-3"
                            : "bg-muted py-2.5",
                        // An instant view with nothing in its start shows no footer at all.
                        apply === "immediate" && "[&:has([data-footer-start]:empty)]:hidden",
                    )}
                >
                    <ViewFormActions
                        phone={phone}
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
