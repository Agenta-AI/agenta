import {
    TriggerDeliveriesDrawer,
    TriggerScheduleDrawer,
    TriggerSubscriptionDrawer,
} from "@agenta/entity-ui/gatewayTrigger"
import {sessionRoutePath} from "@agenta/sessions/link"
import {useRouter} from "next/router"

/**
 * The trigger drawers a session row's automation verbs open — the same three the desktop sessions
 * page mounts, atom-driven, so "Open automation" and "View delivery" land on the same surfaces.
 *
 * Mounted by the SCREEN rather than the row: a drawer opened from a row must survive that row
 * unmounting under it (a refetch, a filter change, a navigation away from the list).
 */
export const SessionAutomationDrawers = ({base}: {base: string}) => {
    const router = useRouter()

    return (
        <>
            <TriggerScheduleDrawer />
            <TriggerSubscriptionDrawer />
            <TriggerDeliveriesDrawer
                onOpenSession={(sessionId) => void router.push(sessionRoutePath(base, sessionId))}
            />
        </>
    )
}
