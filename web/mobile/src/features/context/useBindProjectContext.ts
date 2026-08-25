import {useEffect} from "react"

import {setProjectIdAtom, setSessionAtom} from "@agenta/shared/state"
import {useSetAtom} from "jotai"

/**
 * Publishes the route's context into the SHARED atoms every `@agenta/*` state hook gates on:
 * the project id (query scoping) and the session flag (auth readiness — entity queries stay
 * disabled until the app confirms one). A project-scoped screen is only reachable
 * authenticated (the root resolver bounces to /auth otherwise), so mounting here IS the
 * confirmation. Mount once per project-scoped screen.
 */
export const useBindProjectContext = (projectId: string) => {
    const setProjectId = useSetAtom(setProjectIdAtom)
    const setSession = useSetAtom(setSessionAtom)
    useEffect(() => {
        if (!projectId) return
        setSession(true)
        setProjectId(projectId)
    }, [projectId, setProjectId, setSession])
}
