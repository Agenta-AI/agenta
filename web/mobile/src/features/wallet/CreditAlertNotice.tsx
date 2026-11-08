import {Button} from "@agenta/ui/ui"
import {Coins, X} from "@phosphor-icons/react"

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

// Same tinted strip as `ModelSetupBanner` and `ConnectModelStrip`, so the composer strips read as one family.
const TONES: Record<ShownAlert["kind"], {strip: string; dismissible: boolean}> = {
    low: {
        strip: "border-colorWarning/30 bg-colorWarningBg text-colorWarningText",
        dismissible: true,
    },
    empty: {
        strip: "border-colorErrorBorder bg-colorErrorBg text-colorErrorText",
        dismissible: false,
    },
    daily: {strip: "border-border bg-muted text-muted-foreground", dismissible: true},
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
            role="status"
            className={cn(
                "flex items-center justify-between gap-3 rounded-lg border border-solid px-3 py-2",
                tone.strip,
            )}
        >
            <span className="flex min-w-0 items-center gap-2 text-xs">
                <Coins size={14} className="shrink-0" />
                <span className="min-w-0">
                    <span className="block truncate font-medium">{title}</span>
                    <span className="block truncate tabular-nums">{detail}</span>
                </span>
            </span>
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
                {tone.dismissible ? (
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Dismiss"
                        onClick={onDismiss}
                        className="text-colorTextQuaternary hover:text-colorText size-[22px]"
                    >
                        <X size={11} />
                    </Button>
                ) : null}
            </span>
        </div>
    )
}
