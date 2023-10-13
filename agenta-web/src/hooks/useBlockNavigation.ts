import AlertPopup, {AlertPopupProps} from "@/components/AlertPopup/AlertPopup"
import Router from "next/router"
import {useEffect, useRef} from "react"

const useBlockNavigation = (_blocking: boolean, _props: AlertPopupProps) => {
    // whether the popup has been opened
    const opened = useRef(false)
    const blocking = useRef(_blocking)
    const props = useRef(_props)

    useEffect(() => {
        blocking.current = _blocking
    }, [_blocking])

    useEffect(() => {
        props.current = _props
    }, [_props])

    useEffect(() => {
        // prevent from reload or closing tab
        window.onbeforeunload = () => true

        const handler = (newRoute: string) => {
            if (opened.current || !blocking.current) return

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

            //block NextJS navigation until user confirms or cancels
            throw "cancelRouteChange"
        }

        Router.events.on("routeChangeStart", handler)
        return () => {
            window.onbeforeunload = null
            Router.events.off("routeChangeStart", handler)
        }
    }, [])
}

export default useBlockNavigation
