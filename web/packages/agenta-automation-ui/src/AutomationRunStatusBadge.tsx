import {type TriggerDelivery} from "@agenta/entities/gatewayTrigger"
import {Badge, type BadgeVariant} from "@agenta/ui/ui"
import {CheckCircle, CircleNotch, WarningCircle, XCircle} from "@phosphor-icons/react"

import {deliveryOutcome} from "./automationModel"
import {runOutcomeLabel} from "./runModel"

const TONE: Record<ReturnType<typeof deliveryOutcome>, BadgeVariant> = {
    ok: "success",
    bad: "destructive",
    skipped: "warning",
    pending: "info",
}

/** A run's outcome as a word with its icon (COLOR-03), never a bare dot. */
export const AutomationRunStatusBadge = ({delivery}: {delivery: TriggerDelivery}) => {
    const outcome = deliveryOutcome(delivery)
    const icon =
        outcome === "ok" ? (
            <CheckCircle aria-hidden />
        ) : outcome === "bad" ? (
            <XCircle aria-hidden />
        ) : outcome === "skipped" ? (
            <WarningCircle aria-hidden />
        ) : (
            <CircleNotch aria-hidden className="animate-spin" />
        )
    return (
        <Badge variant={TONE[outcome]} icon={icon}>
            {runOutcomeLabel(delivery)}
        </Badge>
    )
}
