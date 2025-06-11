import {useState, useCallback, useEffect} from "react"

import {Crisp} from "crisp-sdk-web"

export const useCrispChat = () => {
    const [isVisible, setIsVisible] = useState(false)

    const updateVisibility = useCallback((visible: boolean) => {
        if (visible) {
            Crisp.chat.show()
            Crisp.chat.open()
        } else {
            Crisp.chat.hide()
        }
        setIsVisible(visible)
    }, [])

    const toggle = useCallback(() => {
        updateVisibility(!isVisible)
    }, [isVisible, updateVisibility])

    useEffect(() => {
        updateVisibility(false)
    }, [updateVisibility])

    return {
        isVisible,
        setVisible: updateVisibility,
        toggle,
    }
}
