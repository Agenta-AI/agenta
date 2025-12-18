import {useState, useCallback, useEffect} from "react"

import {Crisp} from "crisp-sdk-web"

import {getEnv} from "@/oss/lib/helpers/dynamicEnv"

export const useCrispChat = () => {
    const isCrispEnabled = !!getEnv("NEXT_PUBLIC_CRISP_WEBSITE_ID")

    const [isVisible, setIsVisible] = useState(false)

    const updateVisibility = useCallback(
        (visible: boolean) => {
            if (isCrispEnabled) {
                if (visible) {
                    Crisp.chat.show()
                    Crisp.chat.open()
                } else {
                    Crisp.chat.hide()
                }
                setIsVisible(visible)
            }
        },
        [isCrispEnabled],
    )

    const toggle = useCallback(() => {
        if (isCrispEnabled) {
            updateVisibility(!isVisible)
        }
    }, [isVisible, updateVisibility, isCrispEnabled])

    useEffect(() => {
        if (isCrispEnabled) {
            Crisp.chat.hide()
        }
    }, [isCrispEnabled])

    return {
        isVisible,
        setVisible: updateVisibility,
        toggle,
        isCrispEnabled,
    }
}
