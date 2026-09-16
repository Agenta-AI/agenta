import {useEffect, useState} from "react"

/** True once `flag` has stayed true for `ms`; false again the moment it drops, and the wait
 * starts over whenever `since` changes. */
export const useHeldFor = (flag: boolean, ms: number, since?: unknown): boolean => {
    const [held, setHeld] = useState(false)
    useEffect(() => {
        setHeld(false)
        if (!flag) return
        const id = setTimeout(() => setHeld(true), ms)
        return () => clearTimeout(id)
    }, [flag, ms, since])
    return flag && held
}
