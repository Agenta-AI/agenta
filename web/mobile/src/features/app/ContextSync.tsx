import {useEffect} from "react"

import {useProfile} from "@agenta/entities/profile"
import {useClassicModeCookieSync} from "@agenta/shared/hooks"
import {activeUserIdAtom, setProjectIdAtom, setSessionAtom, setUserAtom} from "@agenta/shared/state"
import {useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {writeLastContext} from "@/lib/context"

/** Null-rendering: mirrors route params into the shared state @agenta/entities reads. */
export const ContextSync = () => {
    const router = useRouter()
    const setProjectId = useSetAtom(setProjectIdAtom)
    const setActiveUserId = useSetAtom(activeUserIdAtom)
    const setSharedUser = useSetAtom(setUserAtom)
    const setSession = useSetAtom(setSessionAtom)
    const {user, isPending: profilePending} = useProfile()

    // The identity half of the app context, and this app's answer to the desktop's
    // `UserListener`. Entity queries scoped by user gate on it — the vault's secrets key is
    // `["vault", "secrets", user?.id, projectId]` with `enabled: !!user` — so without this the
    // Secrets and LLMs tabs sat on their skeletons forever, waiting on a query never enabled.
    useEffect(() => {
        setSharedUser(user)
    }, [user, setSharedUser])

    // Per-user preferences (the Experiments switches) are scoped by this id, and they are read
    // far from Settings — the chat composer asks whether voice is on. Written only once the
    // profile ANSWERS: a pending query is not a signed-out user, and clearing on it would hand
    // someone a blank slate on every reload. A settled answer with no user IS a sign-out though,
    // and holding the old id there would show the next person on this browser the last one's
    // preferences.
    useEffect(() => {
        if (profilePending) return
        setActiveUserId(user?.id ?? null)
    }, [profilePending, user?.id, setActiveUserId])

    // Publish Classic mode as a cookie here too, or a switch flipped on /m would not stick.
    useClassicModeCookieSync()

    // The auth half of the same context, and the other half of the desktop's `SessionListener`.
    // `sessionAtom` defaults to FALSE and every entity query gates on it, so a host that never
    // sets it leaves those queries permanently disabled — and a disabled TanStack v5 query reports
    // `isPending: true` forever, with no request and no error. That is what left the agent's
    // Configuration panel on its skeleton on `/m`: `workflowQueryAtomFamily` never ran, so the
    // revision resolved to `data: null, isPending: true` and the panel's loading gate never
    // cleared. The operational sections below it render from other atoms, which is why only the
    // config rows looked stuck.
    //
    // Driven off the SETTLED profile rather than the route: desktop can pre-set it from a
    // ProtectedRoute-guarded URL, but a project id in a mobile URL is not proof of auth, and
    // optimistically claiming a session would 401-storm every gated query behind it.
    useEffect(() => {
        if (profilePending) return
        setSession(!!user)
    }, [profilePending, user, setSession])

    const {workspace_id, project_id} = router.query
    const workspaceId = typeof workspace_id === "string" ? workspace_id : null
    const projectId = typeof project_id === "string" ? project_id : null

    useEffect(() => {
        if (!router.isReady) return
        setProjectId(projectId)
    }, [router.isReady, projectId, setProjectId])

    useEffect(() => {
        if (workspaceId && projectId) {
            writeLastContext({workspaceId, projectId})
        }
    }, [workspaceId, projectId])

    return null
}
