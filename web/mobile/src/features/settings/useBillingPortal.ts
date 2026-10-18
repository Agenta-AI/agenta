import {useState} from "react"

import {openBillingPortal} from "@agenta/settings-ui"

/** Opens Stripe's billing portal in this tab: a popup after an await is blocked on phones. */
export const useBillingPortal = (projectId: string) => {
    const [opening, setOpening] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const open = async () => {
        setOpening(true)
        setError(null)
        try {
            const url = await openBillingPortal(projectId)
            if (!url) throw new Error("No billing portal URL")
            window.location.assign(url)
        } catch {
            setError("We couldn't open the billing portal. Try again.")
        } finally {
            setOpening(false)
        }
    }
    return {opening, error, open: () => void open()}
}
