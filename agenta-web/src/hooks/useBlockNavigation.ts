import Router from "next/router"
import {useEffect} from "react"

const useBlockNavigation = (
    blocking: boolean,
    {title, onOk, onCancel}: {title: string; onOk?: () => void; onCancel?: () => void},
) => {
    useEffect(() => {
        if (blocking) {
            // prevent from reload or closing tab
            window.onbeforeunload = () => true

            const handler = () => {
                if (confirm(title)) {
                    onOk?.()
                } else {
                    onCancel?.()
                }
            }

            // prevent from NextJS navigation
            Router.events.on("routeChangeStart", handler)
            return () => {
                Router.events.off("routeChangeStart", handler)
            }
        }
    }, [blocking, onOk, onCancel, title])
}

export default useBlockNavigation
