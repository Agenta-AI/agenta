import {useT} from "@agenta/i18n"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import {AppWindow, Lightning, Robot, Wrench, X, type Icon} from "@phosphor-icons/react"

import {cn} from "@/lib/utils"

import {builderTabKey, type BuilderTab, type BuilderTabKind} from "./builderTabs"
import {PrivateMark} from "./PrivateMark"

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
                "flex h-8 min-w-[7.5rem] max-w-[200px] shrink-0 cursor-pointer items-center gap-1.5 rounded-md pl-2 pr-1 text-[13px]",
                active
                    ? "bg-colorFillSecondary font-medium text-colorText"
                    : "text-colorTextSecondary hover:bg-colorFillTertiary hover:text-colorText",
            )}
        >
            <KindIcon aria-hidden size={14} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {tab.kind === "agent" ? <PrivateMark agentId={tab.id} /> : null}
            {tab.dot ? (
                <span
                    data-testid="builder-tab-dot"
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
                className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-colorTextTertiary hover:bg-colorFillSecondary hover:text-colorText"
            >
                <X aria-hidden size={12} />
            </button>
        </div>
    )
}
