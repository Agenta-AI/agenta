import {useEffect, useRef, useState, useCallback} from "react"

import Session from "supertokens-auth-react/recipe/session"

export function useJwtRefresher({intervalMs = 30000}: {intervalMs?: number} = {}) {
    const jwtRef = useRef<string | null>(null)
    const [isReady, setIsReady] = useState(false)

    const fetchJwt = useCallback(async () => {
        try {
            if (await Session.doesSessionExist()) {
                const token = await Session.getAccessToken()
                if (token) {
                    jwtRef.current = token
                }
            }
        } catch (err) {
            console.error("JWT fetch failed", err)
        }
    }, [])

    useEffect(() => {
        let cancelled = false
        const initialize = async () => {
            await fetchJwt()
            if (!cancelled) setIsReady(true)
        }

        initialize()

        const interval = setInterval(() => {
            fetchJwt()
        }, intervalMs)

        return () => {
            cancelled = true
            clearInterval(interval)
        }
    }, [fetchJwt, intervalMs])

    const sendJwtToWorker = useCallback((worker: Worker) => {
        if (jwtRef.current) {
            worker.postMessage({
                type: "UPDATE_JWT",
                jwt: jwtRef.current,
            })
        }
    }, [])

    return {
        jwt: jwtRef.current,
        isReady,
        sendJwtToWorker,
    }
}
