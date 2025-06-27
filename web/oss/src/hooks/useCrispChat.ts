import {useCallback} from "react"

export const useCrispChat = () => {
    const noop = useCallback(() => {}, [])

    return {
        isVisible: false,
        setVisible: noop,
        toggle: noop,
        isCrispEnabled: false,
    }
}
