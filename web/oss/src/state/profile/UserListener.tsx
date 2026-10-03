"use client"

import {useEffect} from "react"

import {activeUserIdAtom, setUserAtom} from "@agenta/shared/state"
import {useAtomValue, useSetAtom} from "jotai"
import {useSessionContext} from "supertokens-auth-react/recipe/session"

import {migrateSessionPreferences} from "@/oss/lib/onboarding/storage"

import {profileQueryAtom, userAtom} from "./selectors/user"

/**
 * Bootstraps the shared `userAtom` (`@agenta/shared/state`) from the OSS
 * profile state.
 *
 * Pattern mirrors `SessionListener` for `sessionAtom` and the
 * `setSharedProjectIdAtom` wiring for `projectIdAtom` — keeping the
 * package-level primitive atoms populated by app code so that entity
 * packages (`@agenta/entities/secret`, etc.) can read user identity
 * without reaching back into OSS state.
 */
const UserListener = () => {
    const user = useAtomValue(userAtom)
    const setSharedUser = useSetAtom(setUserAtom)
    const setActiveUserId = useSetAtom(activeUserIdAtom)
    const profile = useAtomValue(profileQueryAtom)
    const session = useSessionContext()
    const sessionUserId = !session.loading && session.doesSessionExist ? session.userId : null

    useEffect(() => {
        if (profile.isPending || profile.error || session.loading) return
        if (user?.uid && sessionUserId) migrateSessionPreferences(sessionUserId, user.uid)
        setActiveUserId(sessionUserId ? (user?.uid ?? null) : null)
        setSharedUser(sessionUserId ? user : null)
    }, [
        profile.isPending,
        profile.error,
        session.loading,
        sessionUserId,
        user,
        setActiveUserId,
        setSharedUser,
    ])

    return null
}

export default UserListener
