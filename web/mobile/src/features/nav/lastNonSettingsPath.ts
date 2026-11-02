import {useEffect} from "react"

import {atom, useSetAtom} from "jotai"
import {useRouter} from "next/router"

/** Where the settings scope's "← Back" returns to — the desktop keeps the same ref. */
export const lastNonSettingsPathAtom = atom<string | null>(null)

const isSettingsPath = (asPath: string) => asPath.split("?")[0].endsWith("/settings")

/** Records every non-settings route the app shows. Called once, by the AppShell every screen wraps. */
export const useTrackLastNonSettingsPath = () => {
    const router = useRouter()
    const setLastPath = useSetAtom(lastNonSettingsPathAtom)

    useEffect(() => {
        if (!isSettingsPath(router.asPath)) setLastPath(router.asPath)
    }, [router.asPath, setLastPath])
}
