import {useCallback, useState} from "react"

/** The class that shakes a field once per call; it alternates so a repeat error shakes again. */
export function useShake(): [className: string, shake: () => void] {
    const [count, setCount] = useState(0)
    const shake = useCallback(() => setCount((value) => value + 1), [])
    return [count === 0 ? "" : count % 2 ? "auth-shake-a" : "auth-shake-b", shake]
}
