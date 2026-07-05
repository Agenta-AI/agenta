import {useEffect, useRef} from "react"

import {InputRef} from "antd"

// Generic over the ref target so consumers migrated to the primitive Input
// (plain HTMLInputElement) and legacy antd Inputs (InputRef) both work.
const useFocusInput = <T extends HTMLElement | InputRef = InputRef>({
    isOpen,
}: {
    isOpen: boolean
}) => {
    const inputRef = useRef<T>(null)

    // auto focus on input component
    useEffect(() => {
        if (!isOpen) return

        const timer = setTimeout(() => {
            const current = inputRef.current as InputRef | HTMLElement | null
            if (!current) return
            if ("input" in current && current.input) {
                current.input.focus()
            } else if ("focus" in current) {
                ;(current as HTMLElement).focus()
            }
        }, 0)

        return () => clearTimeout(timer)
    }, [isOpen])

    return {inputRef}
}

export default useFocusInput
