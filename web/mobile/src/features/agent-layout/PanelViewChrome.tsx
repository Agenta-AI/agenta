import {useEffect} from "react"

import {useT} from "@agenta/i18n"
import agentLayoutPanelCatalog from "@agenta/i18n/catalogs/agentLayout.panel"
import {cn} from "@agenta/ui/styles"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {PhoneViewHeader, ViewFormActions, type ViewChromeProps} from "@agenta/ui/view-stack"
import {ArrowsOutSimple} from "@phosphor-icons/react"

import {useAgentPanel} from "./agentPanelContext"
import {PanelCloseButton} from "./PanelCloseButton"

/**
 * The right panel's chrome around an open view: the breadcrumb in place of the tabs, "Widen the
 * panel", Close (canvas F01: every view header has both), and the view's action row at the bottom. On a phone the view
 * covers the screen with the phone header (back arrow and title) and 44 px buttons. The view
 * keeps its place in the tree in both, so a resize across the phone width keeps its edits.
 */
export const PanelViewChrome = ({
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
    const t = useT(agentLayoutPanelCatalog)
    const panel = useAgentPanel()
    const {setWide, phone} = panel
    // The widen lasts while this view is open: back restores the stored width.
    useEffect(() => () => setWide(false), [setWide])

    return (
        <div className="flex h-full min-h-0 min-w-0 flex-col">
            {phone ? (
                <PhoneViewHeader crumbs={crumbs} onBack={onBack} />
            ) : (
                <div className="flex h-12 shrink-0 items-center gap-2 border-0 border-b border-solid border-colorBorderSecondary pl-2 pr-1.5">
                    {/* Parent crumbs 13 px fg2, "›" between, the open view 13 px / 600. */}
                    <nav className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px]">
                        {crumbs.map((crumb, index) => (
                            <span key={index} className="flex min-w-0 items-center gap-1.5">
                                {index > 0 ? (
                                    <span aria-hidden className="text-sm text-colorTextTertiary">
                                        ›
                                    </span>
                                ) : null}
                                {crumb.onSelect ? (
                                    <button
                                        type="button"
                                        title={crumb.title}
                                        className="h-7 truncate rounded-md px-1.5 text-colorTextSecondary hover:bg-colorFillTertiary hover:text-colorText"
                                        onClick={crumb.onSelect}
                                    >
                                        {crumb.title}
                                    </button>
                                ) : (
                                    <span
                                        title={crumb.title}
                                        className={cn(
                                            "truncate",
                                            index === crumbs.length - 1
                                                ? "font-semibold text-colorText"
                                                : "px-1.5 text-colorTextSecondary",
                                        )}
                                    >
                                        {crumb.title}
                                    </span>
                                )}
                            </span>
                        ))}
                    </nav>
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
                    <PanelCloseButton />
                </div>
            )}
            {/* Edge to edge: each view pads itself. */}
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
            {readOnly ? null : (
                <div
                    className={cn(
                        "shrink-0 border-0 border-t border-solid border-colorBorderSecondary px-4",
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
