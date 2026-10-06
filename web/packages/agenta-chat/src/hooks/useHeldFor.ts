import {useEffect, useState} from "react"

/** True once `flag` has stayed true for `ms`; false again the moment it drops. */
export const useHeldFor = (flag: boolean, ms: number): boolean => {
    const [held, setHeld] = useState(false)
    useEffect(() => {
        setHeld(false)
        if (!flag) return
        const id = setTimeout(() => setHeld(true), ms)
        return () => clearTimeout(id)
    }, [flag, ms])
    return flag && held
}
