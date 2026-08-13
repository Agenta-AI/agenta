import {useEffect, useState} from "react"

import {altKeyPrefix} from "../utils/platform"

/** The Alt chord prefix for this platform (`⌥` or `Alt+`), resolved after mount so SSR can't
 * mismatch it. Concatenate the key onto it: `` `${altKey}R` `` gives `⌥R` or `Alt+R`. */
export function useAltKey(): string {
    const [prefix, setPrefix] = useState("Alt+")
    useEffect(() => setPrefix(altKeyPrefix()), [])
    return prefix
}
