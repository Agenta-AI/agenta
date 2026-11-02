import {useCallback, useEffect, useState} from "react"

import {useQuery, useQueryClient} from "@tanstack/react-query"

import {fetchTopUpPurchase} from "./api"
import {LANDING_POLL_MS, LANDING_TIMEOUT_MS} from "./topUpRules"

export type TopUpLanding =
    | {state: "waiting"}
    | {state: "landed"; credits: number | null}
    | {state: "timed_out"; retry: () => void}

/**
 * After a paid checkout: polls the purchase until the payment event credits it, or the wait runs
 * out. Polling keeps going in a background tab and rechecks on focus, so a page left open does
 * not report a timeout over credits that already arrived. On landing it refreshes every wallet
 * view, so balances move without a reload. Mount one per Checkout session.
 */
export const useTopUpLanding = ({
    projectId,
    checkoutSessionId,
}: {
    projectId: string
    checkoutSessionId: string
}): TopUpLanding => {
    const queryClient = useQueryClient()
    const [deadline, setDeadline] = useState(() => Date.now() + LANDING_TIMEOUT_MS)
    const [timedOut, setTimedOut] = useState(false)

    const purchase = useQuery({
        queryKey: ["billing", "topups", "purchase", projectId, checkoutSessionId],
        queryFn: () => fetchTopUpPurchase(projectId, checkoutSessionId),
        enabled: Boolean(projectId),
        refetchInterval: (query) =>
            timedOut || query.state.data?.credited ? false : LANDING_POLL_MS,
        refetchIntervalInBackground: true,
        refetchOnWindowFocus: true,
    })
    const credited = purchase.data?.credited === true

    useEffect(() => {
        if (credited || timedOut) return
        const timer = setTimeout(() => setTimedOut(true), Math.max(0, deadline - Date.now()))
        return () => clearTimeout(timer)
    }, [credited, timedOut, deadline])

    useEffect(() => {
        if (!credited) return
        void queryClient.invalidateQueries({queryKey: ["wallet"]})
    }, [credited, queryClient])

    const refetch = purchase.refetch
    const retry = useCallback(() => {
        setDeadline(Date.now() + LANDING_TIMEOUT_MS)
        setTimedOut(false)
        void refetch()
    }, [refetch])

    if (credited) return {state: "landed", credits: purchase.data?.credits ?? null}
    return timedOut ? {state: "timed_out", retry} : {state: "waiting"}
}
