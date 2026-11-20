import {useState} from "react"

import {useT} from "@agenta/i18n"
import builderPanelCatalog from "@agenta/i18n/catalogs/builder.panel"
import {ChartBar, ChatText, Compass, Lightning, Sparkle, type Icon} from "@phosphor-icons/react"

import {cn} from "@/lib/utils"

import {
    QUICK_ACTION_LABELS,
    QUICK_ACTIONS,
    READY_REQUESTS,
    readOpenQuickAction,
    writeOpenQuickAction,
    type QuickAction,
} from "./quickActions"

const ICONS: Record<QuickAction, Icon> = {
    improve: Sparkle,
    test: ChartBar,
    skills: Compass,
    automate: Lightning,
    explain: ChatText,
}

/**
 * The quick actions under the composer of a new chat. One opens its ready requests under the row;
 * a pick puts the request in the composer and sends nothing. On a phone (M04) the actions are
 * 40 px with their icon and a 44 px hit area.
 */
export const QuickActions = ({
    sessionId,
    onPick,
    phone = false,
}: {
    sessionId: string
    onPick: (text: string) => void
    phone?: boolean
}) => {
    const t = useT(builderPanelCatalog)
    const [open, setOpenState] = useState(() => readOpenQuickAction(sessionId))
    const setOpen = (next: QuickAction | null) => {
        writeOpenQuickAction(sessionId, next)
        setOpenState(next)
    }
    const RowIcon = open ? ICONS[open] : null
    return (
        <div className="flex flex-col gap-2" data-testid="builder-quick-actions">
            <div className={cn("flex flex-wrap justify-center", phone ? "gap-2" : "gap-1.5")}>
                {QUICK_ACTIONS.map((action) => {
                    const ActionIcon = ICONS[action]
                    return (
                        <button
                            key={action}
                            type="button"
                            aria-pressed={open === action}
                            onClick={() => setOpen(open === action ? null : action)}
                            className={cn(
                                "inline-flex cursor-pointer items-center rounded-full border-0 text-colorTextSecondary ring-1 ring-inset",
                                phone
                                    ? "relative h-10 gap-1.5 px-3.5 text-sm after:absolute after:-inset-0.5 after:content-['']"
                                    : "h-[30px] px-3 text-[13px]",
                                open === action
                                    ? "bg-colorFillSecondary ring-colorBorder"
                                    : "bg-transparent ring-colorBorderSecondary hover:bg-colorFillTertiary",
                            )}
                        >
                            {phone ? (
                                <ActionIcon
                                    aria-hidden
                                    size={14}
                                    className="text-colorTextSecondary"
                                />
                            ) : null}
                            {t(QUICK_ACTION_LABELS[action])}
                        </button>
                    )
                })}
            </div>
            {open && RowIcon ? (
                <div className="flex flex-col" data-testid="builder-ready-requests">
                    {READY_REQUESTS[open].map((entry) => {
                        const request = t(entry.request)
                        return (
                            <button
                                key={entry.request}
                                type="button"
                                onClick={() => onPick(request)}
                                className="flex w-full cursor-pointer items-start gap-2.5 rounded-md border-0 bg-transparent px-2 py-2 text-left hover:bg-colorFillTertiary"
                            >
                                <RowIcon
                                    aria-hidden
                                    size={14}
                                    className="mt-0.5 shrink-0 text-colorTextSecondary"
                                />
                                <span className="flex min-w-0 flex-col">
                                    <span className="text-[13px] font-medium text-colorText">
                                        {request}
                                    </span>
                                    <span className="text-xs text-colorTextSecondary">
                                        {t(entry.line)}
                                    </span>
                                </span>
                            </button>
                        )
                    })}
                </div>
            ) : null}
        </div>
    )
}
