import {useState} from "react"

import {openBillingPortal} from "@agenta/settings-ui"

/** Opens Stripe's billing portal in this tab: a popup after an await is blocked on phones. */
export const useBillingPortal = () => {
    const [opening, setOpening] = useState(false)
    const open = async () => {
        setOpening(true)
        try {
            const url = await openBillingPortal()
            if (url) window.location.assign(url)
        } finally {
            setOpening(false)
        }
    }
    return {opening, open: () => void open()}
}
