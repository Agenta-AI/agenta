import {useT} from "@agenta/i18n"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import {AppWindow, Lightning, Robot, Wrench, X, type Icon} from "@phosphor-icons/react"

import {cn} from "@/lib/utils"

import {builderTabKey, type BuilderTab, type BuilderTabKind} from "./builderTabs"
import {PrivateMark} from "./PrivateMark"

/** The ids that tie the active builder tab to the pane content below it. */
export const BUILDER_TAB_ID = "builder-tab-active"
export const BUILDER_TAB_PANEL_ID = "builder-tab-panel"

/** The icon of each kind of builder tab. */
export const BUILDER_TAB_ICONS: Record<BuilderTabKind, Icon> = {
    agent: Robot,
    automation: Lightning,
    tool: Wrench,
    app: AppWindow,
}

/** One tab of the strip: icon, name (cut with an ellipsis, full on hover), lock, dot, close. */
export const BuilderTabButton = ({
    tab,
    label,
    active,
    onActivate,
    onClose,
}: {
    tab: BuilderTab
    label: string
    active: boolean
    onActivate?: () => void
    onClose?: () => void
}) => {
    const t = useT(builderPageCatalog)
    const KindIcon = BUILDER_TAB_ICONS[tab.kind]
    return (
        <div
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            title={label}
            data-tab-key={builderTabKey(tab)}
            id={active ? BUILDER_TAB_ID : undefined}
            aria-controls={active ? BUILDER_TAB_PANEL_ID : undefined}
            onClick={onActivate}
            onKeyDown={(event) => {
                // Keys on the close button are the button's own.
                if (event.target !== event.currentTarget) return
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    onActivate?.()
                }
            }}
            className={cn(
                "flex h-7 min-w-[7.5rem] max-w-[200px] shrink-0 cursor-pointer items-center gap-1.5 rounded-[4px] pl-2 pr-1 text-[12px] leading-5",
                active
                    ? "bg-colorFill font-medium text-colorText"
                    : "text-colorTextSecondary hover:bg-colorFillTertiary hover:text-colorText",
            )}
        >
            <KindIcon
                aria-hidden
                size={14}
                className={cn("shrink-0", !active && "text-colorTextTertiary")}
            />
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {tab.kind === "agent" ? <PrivateMark agentId={tab.id} /> : null}
            {tab.dot ? (
                <span
                    data-testid="builder-tab-dot"
                    role="img"
                    aria-label={t("builder.page.changedByBuilder")}
                    className="size-1.5 shrink-0 rounded-full bg-colorPrimary"
                />
            ) : null}
            <button
                type="button"
                aria-label={t("builder.page.closeTab", {name: label})}
                title={t("builder.page.closeTab", {name: label})}
                onClick={(event) => {
                    event.stopPropagation()
                    onClose?.()
                }}
                className="flex size-[18px] shrink-0 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-colorTextQuaternary hover:bg-colorFillSecondary hover:text-colorText"
            >
                <X aria-hidden size={12} />
            </button>
        </div>
    )
}
