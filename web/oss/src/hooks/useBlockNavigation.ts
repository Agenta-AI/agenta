import {useEffect, useRef} from "react"

import Router from "next/router"

import AlertPopup, {AlertPopupProps} from "@/oss/components/AlertPopup/AlertPopup"

const useBlockNavigation = (
    _blocking: boolean,
    _props: AlertPopupProps,
    _shouldAlert?: (newRoute: string) => boolean,
) => {
    // whether the popup has been opened
    const opened = useRef(false)
    const blocking = useRef(_blocking)
    const props = useRef(_props)
    const shouldAlert = useRef(_shouldAlert)

    const beforeUnloadHandler = (event: BeforeUnloadEvent) => {
        if (blocking.current) {
            const message = "You have unsaved changes. Are you sure you want to leave?"
            event.returnValue = message // Standard for most browsers
            return message // For some older browsers
        }
    }

    useEffect(() => {
        blocking.current = _blocking

        // prevent from reload or closing tab with unsaved changes
        window.addEventListener("beforeunload", beforeUnloadHandler)

        return () => {
            window.removeEventListener("beforeunload", beforeUnloadHandler)
        }
    }, [_blocking])

    useEffect(() => {
        props.current = _props
    }, [_props])

    useEffect(() => {
        shouldAlert.current = _shouldAlert
    }, [_shouldAlert])

    useEffect(() => {
        const handler = (newRoute: string) => {
            if (opened.current || !blocking.current) return

            if (shouldAlert.current && !shouldAlert.current(newRoute)) return

            opened.current = true
            AlertPopup({
                okButtonProps: {
                    type: "primary",
                    ...(props.current.okButtonProps || {}),
                },
                ...props.current,
                onOk: async () => {
                    if (props.current.onOk) {
                        const res = await props.current.onOk()
                        if (res) {
                            Router.push(newRoute)
                        } else {
                        }
                    } else {
                        Router.push(newRoute)
                    }
                    opened.current = false
                    blocking.current = false
                },
                onCancel: async () => {
                    // Cancel just closes the modal and stays on page
                    opened.current = false
                },
                onThirdButton: async () => {
                    // Third button (e.g., "Discard changes") navigates without saving
                    if (props.current.onThirdButton) {
                        await props.current.onThirdButton()
                    }
                    Router.push(newRoute)
                    opened.current = false
                    blocking.current = false
                },
                cancellable: true,
            })

            //block NextJS navigation until user confirms or cancels
            throw "cancelRouteChange"
        }

        Router.events.on("routeChangeStart", handler)
        return () => {
            window.removeEventListener("beforeunload", beforeUnloadHandler)
            Router.events.off("routeChangeStart", handler)
        }
    }, [])
}

export default useBlockNavigation
