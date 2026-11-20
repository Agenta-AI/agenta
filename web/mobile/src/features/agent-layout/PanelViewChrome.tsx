import {useEffect} from "react"

import {useT} from "@agenta/i18n"
import agentLayoutPanelCatalog from "@agenta/i18n/catalogs/agentLayout.panel"
import {cn} from "@agenta/ui/styles"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {ViewFormActions, type ViewChromeProps} from "@agenta/ui/view-stack"
import {ArrowLeft, ArrowsOutLineHorizontal, CaretRight, X} from "@phosphor-icons/react"

import {useAgentPanel} from "./agentPanelContext"

/**
 * The right panel's chrome around an open view: the breadcrumb in place of the tabs, "Widen the
 * panel" for a wide view, Close, and the view's action row at the bottom. On a phone the
 * breadcrumb gives way to a back arrow.
 */
export const PanelViewChrome = ({
    crumbs,
    apply,
    wide,
    form,
    onBack,
    onCancel,
    onSave,
    children,
}: ViewChromeProps) => {
    const t = useT(agentLayoutPanelCatalog)
    const panel = useAgentPanel()
    const {setWide} = panel
    // The widen lasts while this view is open: back restores the stored width.
    useEffect(() => () => setWide(false), [setWide])

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex h-12 shrink-0 items-center gap-1 border-0 border-b border-solid border-colorBorderSecondary px-3">
                {panel.phone ? (
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("agentLayout.panel.back")}
                        className="size-11 shrink-0"
                        onClick={onBack}
                    >
                        <ArrowLeft size={18} />
                    </Button>
                ) : null}
                <nav className="flex min-w-0 flex-1 items-center gap-1 text-sm">
                    {(panel.phone ? crumbs.slice(-1) : crumbs).map((crumb, index, shown) => (
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
                                        index === shown.length - 1 && "font-medium text-colorText",
                                    )}
                                >
                                    {crumb.title}
                                </span>
                            )}
                        </span>
                    ))}
                </nav>
                {wide && !panel.phone ? (
                    <SimpleTooltip title={t("agentLayout.panel.widen")}>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("agentLayout.panel.widen")}
                            aria-pressed={panel.wide}
                            onClick={() => setWide(!panel.wide)}
                        >
                            <ArrowsOutLineHorizontal size={16} />
                        </Button>
                    </SimpleTooltip>
                ) : null}
                {panel.phone ? null : (
                    <SimpleTooltip title={t("agentLayout.panel.close")}>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("agentLayout.panel.close")}
                            onClick={() => void panel.close()}
                        >
                            <X size={16} />
                        </Button>
                    </SimpleTooltip>
                )}
            </div>
            {/* Edge to edge: each view pads its own content. */}
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
            <div className="shrink-0 border-0 border-t border-solid border-colorBorderSecondary px-4 py-3">
                <ViewFormActions
                    apply={apply}
                    form={form}
                    onBack={onBack}
                    onCancel={onCancel}
                    onSave={onSave}
                />
            </div>
        </div>
    )
}
