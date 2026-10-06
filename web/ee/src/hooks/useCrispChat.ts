import {useState, useCallback, useEffect} from "react"

import {Crisp} from "crisp-sdk-web"
import {useAtomValue} from "jotai"

import {liveChatAllowedAtom} from "@/oss/state/access/atoms"

export const useCrispChat = () => {
    const isCrispEnabled = useAtomValue(liveChatAllowedAtom)

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

    // Hidden on mount, and again if the organization loses live chat mid-session.
    useEffect(() => {
        Crisp.chat.hide()
        setIsVisible(false)
    }, [isCrispEnabled])

    return {
        isVisible,
        setVisible: updateVisibility,
        toggle,
        isCrispEnabled,
    }
}
