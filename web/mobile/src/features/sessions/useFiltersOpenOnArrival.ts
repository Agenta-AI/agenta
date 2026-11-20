import {useEffect, useState} from "react"

import {useRouter} from "next/router"

/** The query param the agent sidebar's Filter link sets: `?view=sessions&filters=open`. */
export const FILTERS_OPEN_PARAM = "filters"

/**
 * The open state of the Sessions filter menu. A link with `filters=open` lands with the menu
 * open (A10). It opens once: the param leaves the address, so a reload keeps the menu closed.
 */
export const useFiltersOpenOnArrival = () => {
    const router = useRouter()
    const [open, setOpen] = useState(false)
    const arrivedOpen = router.query[FILTERS_OPEN_PARAM] === "open"
    useEffect(() => {
        if (!arrivedOpen) return
        setOpen(true)
        const query = {...router.query}
        delete query[FILTERS_OPEN_PARAM]
        void router.replace({pathname: router.pathname, query}, undefined, {shallow: true})
    }, [arrivedOpen, router])
    return [open, setOpen] as const
}
