import {Button} from "@agenta/ui/ui"
import {Coins} from "@phosphor-icons/react"
import {X} from "lucide-react"

import {cn} from "@/lib/utils"

import type {CreditAlert} from "./creditAlert"
import type {ModelFunding} from "./modelFunding"
import {formatCredits} from "./walletFormat"

export type ShownAlert = Exclude<CreditAlert, {kind: "none"}>
export type CreditAlertAction = "switch-model" | "add-key" | "buy"

/** Whether this user can buy credits: `null` while the permission check is still running. */
export type CanBuy = boolean | null

interface NoticeCopy {
    title: string
    detail: string
}

interface NoticeRow {
    copy: (alert: ShownAlert, canBuy: CanBuy) => NoticeCopy
    main: CreditAlertAction | null
    secondary: CreditAlertAction | null
}

const ACTION_LABELS: Record<CreditAlertAction, string> = {
    "switch-model": "Switch model",
    "add-key": "Add a key",
    buy: "Buy credits",
}

const lowCopy = (detail: string) => (alert: ShownAlert) => ({
    title: "Running low on credits",
    detail: `${alert.kind === "low" ? formatCredits(alert.remainingMusd) : "0"} credits left${detail}`,
})

const emptyCopy = (_: ShownAlert, canBuy: CanBuy) => ({
    title: "Out of credits",
    detail:
        canBuy === false
            ? "Ask an admin to add credits."
            : "New tasks will not start until you add credits.",
})

const dailyCopy = (alert: ShownAlert) => {
    if (alert.kind !== "daily" || alert.todayMusd === null)
        return {
            title: "Free credits on the way",
            detail: "Today's free credits arrive with your next task.",
        }
    const left = `${formatCredits(alert.todayMusd)} left today.`
    return {
        title: "Running on today's free credits",
        detail: alert.refills ? `${left} They reset at 00:00 UTC.` : left,
    }
}

const ROWS: Record<ShownAlert["kind"], Record<ModelFunding, NoticeRow>> = {
    low: {
        "credits-with-own-key": {
            copy: lowCopy(". Switch to your own model key to save credits."),
            main: "switch-model",
            secondary: "buy",
        },
        "credits-no-own-key": {
            copy: lowCopy(". Add your own model key to save credits."),
            main: "add-key",
            secondary: "buy",
        },
        "own-key": {copy: lowCopy(" for agent runtime and tools."), main: "buy", secondary: null},
    },
    empty: {
        "credits-with-own-key": {copy: emptyCopy, main: "buy", secondary: "switch-model"},
        "credits-no-own-key": {copy: emptyCopy, main: "buy", secondary: "add-key"},
        "own-key": {copy: emptyCopy, main: "buy", secondary: null},
    },
    daily: {
        "credits-with-own-key": {copy: dailyCopy, main: null, secondary: "switch-model"},
        "credits-no-own-key": {copy: dailyCopy, main: null, secondary: "add-key"},
        "own-key": {copy: dailyCopy, main: null, secondary: null},
    },
}

const TONES: Record<ShownAlert["kind"], {tile: string; dismissible: boolean}> = {
    low: {tile: "bg-colorWarningBg text-colorWarningText", dismissible: true},
    empty: {tile: "bg-colorErrorBg text-colorErrorText", dismissible: false},
    daily: {tile: "bg-muted text-muted-foreground", dismissible: true},
}

/** The credit card's content for one alert; `CreditAlertStrip` supplies the data and the actions. */
export const CreditAlertNotice = ({
    alert,
    funding,
    canBuy,
    onAction,
    onDismiss,
}: {
    alert: ShownAlert
    /** `null` while the agent's model routes load; it reads as the own-key row. */
    funding: ModelFunding | null
    canBuy: CanBuy
    onAction: (action: CreditAlertAction) => void
    onDismiss: () => void
}) => {
    const row = ROWS[alert.kind][funding ?? "own-key"]
    const tone = TONES[alert.kind]
    const {title, detail} = row.copy(alert, canBuy)
    const available = (action: CreditAlertAction | null) =>
        action === "buy" && canBuy !== true ? null : action
    const main = available(row.main)
    const secondary = available(row.secondary)

    return (
        <div
            className={cn(
                "border-border bg-background relative mb-2 flex items-center gap-3 rounded-[14px] border border-solid py-3 pl-3.5",
                tone.dismissible ? "pr-9" : "pr-3.5",
            )}
        >
            <span
                className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-[10px]",
                    tone.tile,
                )}
            >
                <Coins size={18} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-px">
                <span className="text-foreground text-[13px] leading-[18px] font-medium">
                    {title}
                </span>
                <span className="text-muted-foreground text-xs leading-[17px] tabular-nums">
                    {detail}
                </span>
            </span>
            {main || secondary ? (
                <span className="flex shrink-0 items-center gap-1.5">
                    {secondary ? (
                        <Button size="sm" variant="outline" onClick={() => onAction(secondary)}>
                            {ACTION_LABELS[secondary]}
                        </Button>
                    ) : null}
                    {main ? (
                        <Button size="sm" onClick={() => onAction(main)}>
                            {ACTION_LABELS[main]}
                        </Button>
                    ) : null}
                </span>
            ) : null}
            {tone.dismissible ? (
                <button
                    type="button"
                    aria-label="Dismiss"
                    onClick={onDismiss}
                    className="text-muted-foreground hover:text-foreground absolute top-2 right-2 flex size-[18px] cursor-pointer items-center justify-center border-none bg-transparent p-0"
                >
                    <X className="size-3.5" />
                </button>
            ) : null}
        </div>
    )
}
