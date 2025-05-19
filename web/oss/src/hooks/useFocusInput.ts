import {useEffect, useRef} from "react"

import {InputRef} from "antd"

const useFocusInput = ({isOpen}: {isOpen: boolean}) => {
    const inputRef = useRef<InputRef>(null)

    // auto focus on input component
    useEffect(() => {
        if (isOpen && inputRef.current?.input) {
            setTimeout(() => {
                inputRef.current?.input?.focus()
            }, 0)
        }
    }, [isOpen])

    return {inputRef}
}

export default useFocusInput
