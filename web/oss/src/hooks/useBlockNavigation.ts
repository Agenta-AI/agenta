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
        // Handle unhandled promise rejections for our intentional route cancellation
        const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
            if (event.reason === "cancelRouteChange") {
                event.preventDefault()
            }
        }

        window.addEventListener("unhandledrejection", handleUnhandledRejection)

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
                    if (props.current.onCancel) {
                        const res = await props.current.onCancel()
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
                cancellable: false,
            })

            // Block NextJS navigation until user confirms or cancels
            Router.events.emit("routeChangeError")
            throw "cancelRouteChange"
        }

        Router.events.on("routeChangeStart", handler)
        return () => {
            window.removeEventListener("beforeunload", beforeUnloadHandler)
            window.removeEventListener("unhandledrejection", handleUnhandledRejection)
            Router.events.off("routeChangeStart", handler)
        }
    }, [])
}

export default useBlockNavigation
