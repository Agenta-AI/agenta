import {useEffect, useState} from "react"

import {subscribeMaintenanceNotice, type MaintenanceNotice} from "@agenta/shared/analytics"
import {useAtomValue} from "jotai"

import {posthogAtom} from "@/features/analytics/client"

/**
 * The notice the `maintenance-notice` PostHog flag describes, re-read whenever PostHog
 * refreshes its flags. Null when there is no PostHog (self-hosted, no key), the flag is
 * off, or the payload cannot be read.
 */
export const useMaintenanceNotice = (): MaintenanceNotice | null => {
    const client = useAtomValue(posthogAtom)
    const [notice, setNotice] = useState<MaintenanceNotice | null>(null)

    useEffect(() => {
        if (!client) {
            setNotice(null)
            return
        }
        return subscribeMaintenanceNotice(client, setNotice)
    }, [client])

    return notice
}
