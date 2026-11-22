import {useT} from "@agenta/i18n"
import builderPanelCatalog from "@agenta/i18n/catalogs/builder.panel"

import {cn} from "@/lib/utils"

import {READY_REQUESTS} from "./quickActions"

/** The ready requests of a new chat about one agent; a pick fills the composer and sends nothing. */
export const QuickActions = ({
    agentName,
    onPick,
    phone = false,
}: {
    agentName: string
    onPick: (text: string) => void
    phone?: boolean
}) => {
    const t = useT(builderPanelCatalog)
    return (
        <div
            className="flex flex-col overflow-hidden rounded-[10px] border border-solid border-colorBorderSecondary bg-colorBgContainer"
            data-testid="builder-ready-requests"
        >
            {READY_REQUESTS.map((entry) => (
                <button
                    key={entry.title}
                    type="button"
                    onClick={() => onPick(t(entry.request, {agent: agentName}))}
                    className={cn(
                        "flex w-full cursor-pointer flex-col border-0 border-b border-solid border-colorBorderSecondary bg-transparent px-3 text-left last:border-b-0 hover:bg-muted",
                        // A phone row is at least 44 px high.
                        phone ? "min-h-11 py-2.5" : "py-2",
                    )}
                >
                    <span className="text-[13px] font-medium leading-5 text-colorText">
                        {t(entry.title)}
                    </span>
                    <span className="text-[12px] leading-4 text-colorTextSecondary">
                        {t(entry.line)}
                    </span>
                </button>
            ))}
        </div>
    )
}
