import {Button} from "@agenta/ui/ui"
import {AlertTriangle, Clock, X, XCircle, type LucideIcon} from "lucide-react"

import type {CreditAlert} from "./creditAlert"
import type {ModelFunding} from "./modelFunding"
import {formatCredits} from "./walletFormat"

export type ShownAlert = Exclude<CreditAlert, {kind: "none"}>
export type CreditAlertAction = "switch-model" | "add-key" | "buy"

/** Whether this user can buy credits: `null` while the permission check is still running. */
export type CanBuy = boolean | null

interface NoticeRow {
    text: (alert: ShownAlert, canBuy: CanBuy) => string
    main: CreditAlertAction | null
    secondary: CreditAlertAction | null
}

const ACTION_LABELS: Record<CreditAlertAction, string> = {
    "switch-model": "Switch model",
    "add-key": "Add a key",
    buy: "Buy credits",
}

const lowLeft = (alert: ShownAlert) =>
    alert.kind === "low" ? `${formatCredits(alert.remainingMusd)} credits left` : ""

const outOfCredits = (_: ShownAlert, canBuy: CanBuy) =>
    canBuy === false
        ? "Out of credits. Ask an admin to add credits."
        : "Out of credits. New tasks will not start until you add credits."

const onDaily = (alert: ShownAlert) => {
    if (alert.kind !== "daily") return ""
    if (alert.todayMusd === null) return "Today's free credits arrive with your next task."
    const left = `Running on today's free credits (${formatCredits(alert.todayMusd)} left).`
    return alert.refills ? `${left} They reset at 00:00 UTC.` : left
}

const ROWS: Record<ShownAlert["kind"], Record<ModelFunding, NoticeRow>> = {
    low: {
        "credits-with-own-key": {
            text: (a) => `${lowLeft(a)}. Switch to your own model key to save credits.`,
            main: "switch-model",
            secondary: "buy",
        },
        "credits-no-own-key": {
            text: (a) => `${lowLeft(a)}. Add your own model key to save credits.`,
            main: "add-key",
            secondary: "buy",
        },
        "own-key": {
            text: (a) => `${lowLeft(a)} for agent runtime and tools.`,
            main: "buy",
            secondary: null,
        },
    },
    empty: {
        "credits-with-own-key": {text: outOfCredits, main: "buy", secondary: "switch-model"},
        "credits-no-own-key": {text: outOfCredits, main: "buy", secondary: "add-key"},
        "own-key": {text: outOfCredits, main: "buy", secondary: null},
    },
    daily: {
        "credits-with-own-key": {text: onDaily, main: null, secondary: "switch-model"},
        "credits-no-own-key": {text: onDaily, main: null, secondary: "add-key"},
        "own-key": {text: onDaily, main: null, secondary: null},
    },
}

const TONES: Record<
    ShownAlert["kind"],
    {className: string; Icon: LucideIcon; dismissible: boolean}
> = {
    low: {
        className: "border-colorWarning/30 bg-colorWarningBg text-colorWarningText",
        Icon: AlertTriangle,
        dismissible: true,
    },
    empty: {
        className: "border-colorErrorBorder bg-colorErrorBg text-colorErrorText",
        Icon: XCircle,
        dismissible: false,
    },
    daily: {
        className: "border-border bg-muted text-muted-foreground",
        Icon: Clock,
        dismissible: true,
    },
}

/** The strip's content for one alert; `CreditAlertStrip` supplies the data and the actions. */
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
    const available = (action: CreditAlertAction | null) =>
        action === "buy" && canBuy !== true ? null : action
    const main = available(row.main)
    const secondary = available(row.secondary)

    return (
        <div
            className={`mb-2 flex items-center justify-between gap-3 rounded-lg border border-solid px-3 py-2 ${tone.className}`}
        >
            <span className="flex min-w-0 items-center gap-2 text-xs">
                <tone.Icon className="size-3.5 shrink-0" />
                <span className="min-w-0">{row.text(alert, canBuy)}</span>
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
                    <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={onDismiss}>
                        <X className="size-3.5" />
                    </Button>
                ) : null}
            </span>
        </div>
    )
}
