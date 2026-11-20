import {
    triggerDeliveriesDrawerAtom,
    useTriggerDelivery,
    type ExactDeliveryDrawerState,
} from "@agenta/entities/gatewayTrigger"
import {useT} from "@agenta/i18n"
import triggerDeliveriesCatalog from "@agenta/i18n/catalogs/entityUi.triggerDeliveries"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {Button, EmptyState, Skeleton} from "@agenta/ui/ui"
import {useAtom} from "jotai"

import {DeliveryDetails} from "./DeliveryDetails"
import {openLinkedDeliverySession} from "./linkedSessionAction"

export interface TriggerDeliveriesDrawerProps {
    onOpenSession?: (sessionId: string, applicationId: string) => void
}

function ExactDeliveryView({
    state,
    onOpenSession,
}: {
    state: ExactDeliveryDrawerState
    onOpenSession?: TriggerDeliveriesDrawerProps["onOpenSession"]
}) {
    const t = useT(triggerDeliveriesCatalog)
    const {delivery, isLoading, error, refetch} = useTriggerDelivery(state.deliveryId)

    if (isLoading) {
        return <Skeleton active paragraph={{rows: 8}} title={false} />
    }
    if (error) {
        return (
            <EmptyState description={t("entityUi.triggerDeliveries.couldNotLoadDelivery")}>
                <Button onClick={() => void refetch()}>
                    {t("entityUi.triggerDeliveries.retry")}
                </Button>
            </EmptyState>
        )
    }
    if (!delivery)
        return <EmptyState description={t("entityUi.triggerDeliveries.deliveryNotFound")} />

    return (
        <DeliveryDetails
            delivery={delivery}
            deliveryIdFallback={state.deliveryId}
            onOpenSession={onOpenSession}
        />
    )
}

/**
 * One delivery, opened from a session row ("View delivery"). An automation's run history is the
 * run history view of `@agenta/automation-ui`; this drawer shows a single delivery's details.
 */
export default function TriggerDeliveriesDrawer({onOpenSession}: TriggerDeliveriesDrawerProps) {
    const t = useT(triggerDeliveriesCatalog)
    const [state, setState] = useAtom(triggerDeliveriesDrawerAtom)
    const openLinkedSession = onOpenSession
        ? (sessionId: string, applicationId: string) =>
              openLinkedDeliverySession({
                  closeDrawer: () => setState(null),
                  navigate: onOpenSession,
                  sessionId,
                  applicationId,
              })
        : undefined

    return (
        <EnhancedDrawer
            open={Boolean(state)}
            onClose={() => setState(null)}
            title={t("entityUi.triggerDeliveries.deliveryDetails")}
            width={720}
            destroyOnClose
            styles={{
                body: {padding: 0, display: "flex", flexDirection: "column", overflow: "hidden"},
            }}
        >
            {state ? (
                <div className="h-full overflow-y-auto p-6">
                    <ExactDeliveryView state={state} onOpenSession={openLinkedSession} />
                </div>
            ) : null}
        </EnhancedDrawer>
    )
}
