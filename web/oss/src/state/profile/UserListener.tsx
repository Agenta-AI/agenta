"use client"

import {useEffect} from "react"

import {setUserAtom} from "@agenta/shared/state"
import {useAtomValue, useSetAtom} from "jotai"

import {userAtom} from "./selectors/user"

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

    useEffect(() => {
        setSharedUser(user)
    }, [user, setSharedUser])

    return null
}

export default UserListener
