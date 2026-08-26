import {useEffect, useState} from "react"

import {isMacPlatform} from "@agenta/shared/utils"

/**
 * Which modifier glyph this viewer's keyboard uses.
 *
 * Seeded to Apple and corrected after mount, never read during render: the server has no
 * platform to report, so reading it while rendering mismatches hydration. Seeding Apple (rather
 * than the other way round) keeps the first paint identical to what the composer already ships.
 */
export function useShortcutPlatform(): {isMac: boolean} {
    const [isMac, setIsMac] = useState(true)
    useEffect(() => {
        setIsMac(isMacPlatform())
    }, [])
    return {isMac}
}
