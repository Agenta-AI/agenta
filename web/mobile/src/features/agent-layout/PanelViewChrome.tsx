import {useEffect} from "react"

import {useT} from "@agenta/i18n"
import agentLayoutPanelCatalog from "@agenta/i18n/catalogs/agentLayout.panel"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {cn} from "@agenta/ui/styles"
import {BackLink, Button, SimpleTooltip} from "@agenta/ui/ui"
import {PhoneViewHeader, ViewFormActions, type ViewChromeProps} from "@agenta/ui/view-stack"
import {ArrowsOutSimple} from "@phosphor-icons/react"

import {useAgentPanel} from "./agentPanelContext"
import {PanelCloseButton} from "./PanelCloseButton"

/**
 * The right panel's chrome around an open view: a back link to the parent in place of the tabs, "Widen the
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
    // A step inside the view goes back to the step before; else up to the view it opened from.
    const parent = crumbs.length > 1 ? crumbs[crumbs.length - 2] : null
    const back = showBack
        ? {title: crumbs[crumbs.length - 1]?.title ?? t("common.back"), onSelect: onBack}
        : parent?.onSelect
          ? {title: parent.title, onSelect: parent.onSelect}
          : null
    // A view with no widen button never stays wide: it has no button to narrow it again.
    useEffect(() => {
        if (!showWiden) setWide(false)
    }, [showWiden, setWide])

    return (
        <div className="flex h-full min-h-0 min-w-0 flex-col">
            {phone ? (
                <PhoneViewHeader crumbs={crumbs} onBack={onBack} form={form} />
            ) : (
                <div className="flex h-12 shrink-0 items-center gap-2 border-0 border-b border-solid border-border-muted pl-2 pr-1.5">
                    {/* One way up, named for where it leads: the view's own last step, else the
                        view it opened from ("← Agent"). */}
                    <div className="flex min-w-0 flex-1 items-center pl-1.5">
                        {back ? (
                            <BackLink
                                size="bar"
                                title={back.title}
                                onClick={back.onSelect}
                                className="max-w-full"
                            >
                                <span className="truncate">{back.title}</span>
                            </BackLink>
                        ) : null}
                    </div>
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
