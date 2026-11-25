import {useEffect} from "react"

import {useT} from "@agenta/i18n"
import agentLayoutPanelCatalog from "@agenta/i18n/catalogs/agentLayout.panel"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {cn} from "@agenta/ui/styles"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {PhoneViewHeader, ViewFormActions, type ViewChromeProps} from "@agenta/ui/view-stack"
import {ArrowLeft, ArrowsOutSimple} from "@phosphor-icons/react"

import {useAgentPanel} from "./agentPanelContext"
import {PanelCloseButton} from "./PanelCloseButton"

/**
 * The right panel's chrome around an open view: the breadcrumb in place of the tabs, "Widen the
 * panel" (unless the view sets `widenButton: false`, F02-05), Close, and the view's action row at
 * the bottom. On a phone the view covers the screen with the phone header (back arrow and title)
 * and 44 px buttons. The view keeps its place in the tree in both, so a resize across the phone
 * width keeps its edits.
 */
export const PanelViewChrome = ({
    crumbs,
    apply,
    hideActionRow,
    showWiden,
    showBack,
    form,
    footerStartRef,
    onBack,
    onCancel,
    onSave,
    children,
}: ViewChromeProps) => {
    const t = useT(agentLayoutPanelCatalog, commonCatalog)
    const panel = useAgentPanel()
    const {setWide, phone} = panel
    // The widen lasts while the views are open: closing them restores the stored width.
    useEffect(() => () => setWide(false), [setWide])
    // A view with no widen button never stays wide: it has no button to narrow it again.
    useEffect(() => {
        if (!showWiden) setWide(false)
    }, [showWiden, setWide])

    return (
        <div className="flex h-full min-h-0 min-w-0 flex-col">
            {phone ? (
                <PhoneViewHeader crumbs={crumbs} onBack={onBack} />
            ) : (
                <div className="flex h-12 shrink-0 items-center gap-2 border-0 border-b border-solid border-border-muted pl-2 pr-1.5">
                    {/* A step inside the view goes back to the step before. */}
                    {showBack ? (
                        <SimpleTooltip title={t("common.back")}>
                            <Button
                                variant="ghost"
                                size="icon-compact"
                                aria-label={t("common.back")}
                                onClick={onBack}
                            >
                                <ArrowLeft size={16} />
                            </Button>
                        </SimpleTooltip>
                    ) : null}
                    {/* Parent crumbs 13 px fg2, "›" between, the open view 13 px / 600. When the
                        row is short, the parent crumbs give up their width first (down to 48 px
                        each; shrink 1000 against 1), so the open view keeps its full name while it
                        fits (F05-06). */}
                    <nav className="flex min-w-0 flex-1 items-center gap-1.5 text-label">
                        {crumbs.map((crumb, index) => {
                            const last = index === crumbs.length - 1
                            return (
                                <span
                                    key={index}
                                    className={cn(
                                        "flex items-center gap-1.5",
                                        last ? "min-w-0" : "min-w-12 shrink-[1000]",
                                    )}
                                >
                                    {index > 0 ? (
                                        <span
                                            aria-hidden
                                            className="text-label text-muted-foreground"
                                        >
                                            ›
                                        </span>
                                    ) : null}
                                    {crumb.onSelect ? (
                                        <button
                                            type="button"
                                            title={crumb.title}
                                            className="h-7 min-w-0 truncate rounded-md px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                                            onClick={crumb.onSelect}
                                        >
                                            {crumb.title}
                                        </button>
                                    ) : (
                                        <span
                                            title={crumb.title}
                                            className={cn(
                                                "truncate",
                                                last
                                                    ? "font-semibold text-foreground"
                                                    : "px-1.5 text-muted-foreground",
                                            )}
                                        >
                                            {crumb.title}
                                        </span>
                                    )}
                                </span>
                            )
                        })}
                    </nav>
                    {showWiden ? (
                        <SimpleTooltip title={t("agentLayout.panel.widen")}>
                            <Button
                                variant="ghost"
                                size="icon-compact"
                                aria-label={t("agentLayout.panel.widen")}
                                aria-pressed={panel.wide}
                                onClick={() => setWide(!panel.wide)}
                            >
                                <ArrowsOutSimple size={16} />
                            </Button>
                        </SimpleTooltip>
                    ) : null}
                    <PanelCloseButton />
                </div>
            )}
            {/* Edge to edge: each view pads itself. */}
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
            {hideActionRow ? null : (
                <div
                    className={cn(
                        "shrink-0 border-0 border-t border-solid border-border-muted px-4",
                        phone ? "pb-6 pt-3" : "py-3",
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
