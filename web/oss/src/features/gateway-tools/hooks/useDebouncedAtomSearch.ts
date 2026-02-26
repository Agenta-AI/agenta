import {useCallback, useEffect, useRef, useState} from "react"

export function useDebouncedAtomSearch(setAtom: (v: string) => void, delay = 300) {
    const [local, setLocal] = useState("")
    const timerRef = useRef<ReturnType<typeof setTimeout>>()

    const onChange = useCallback(
        (v: string) => {
            setLocal(v)
            clearTimeout(timerRef.current)
            timerRef.current = setTimeout(() => setAtom(v), delay)
        },
        [setAtom, delay],
    )

    const reset = useCallback(() => {
        clearTimeout(timerRef.current)
        setLocal("")
        setAtom("")
    }, [setAtom])

    useEffect(() => () => clearTimeout(timerRef.current), [])

    return {value: local, onChange, reset}
}
