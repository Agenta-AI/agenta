import type {ReactNode} from "react"

import type {DeliveriesDrawerState} from "@agenta/entities/gatewayTrigger"

export function TriggerDeliveriesDrawerContent({
    state,
    ownerHistory,
    exactDelivery,
}: {
    state: DeliveriesDrawerState
    ownerHistory: ReactNode
    exactDelivery: ReactNode
}) {
    return state.mode === "exact-delivery" ? exactDelivery : ownerHistory
}
