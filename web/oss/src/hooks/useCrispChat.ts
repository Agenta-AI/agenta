import {useState, useCallback, useEffect} from "react"

import {Crisp} from "crisp-sdk-web"

import {getEnv} from "@/oss/lib/helpers/dynamicEnv"

export const useCrispChat = () => {
    // Check if Crisp chat is enabled (has a website ID)
    const isCrispEnabled = !!getEnv("NEXT_PUBLIC_CRISP_WEBSITE_ID")

    const [isVisible, setIsVisible] = useState(false)

    const updateVisibility = useCallback(
        (visible: boolean) => {
            // Only show/hide if Crisp is enabled
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
        // Only toggle if Crisp is enabled
        if (isCrispEnabled) {
            updateVisibility(!isVisible)
        }
    }, [isVisible, updateVisibility, isCrispEnabled])

    useEffect(() => {
        updateVisibility(false)
    }, [updateVisibility])

    return {
        isVisible,
        setVisible: updateVisibility,
        toggle,
        isCrispEnabled,
    }
}
