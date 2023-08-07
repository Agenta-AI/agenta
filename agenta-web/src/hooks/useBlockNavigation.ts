import Router from "next/router"
import {useEffect} from "react"

const useBlockNavigation = (
    blocking: boolean,
    {title, onOk, onCancel}: {title: string; onOk?: () => boolean; onCancel?: () => boolean},
) => {
    useEffect(() => {
        if (blocking) {
            // prevent from reload or closing tab
            window.onbeforeunload = () => true

            const handler = () => {
                let res = true
                if (confirm(title) && onOk) {
                    res = !!onOk()
                } else if (onCancel) {
                    res = !!onCancel()
                }

                // block navigation if onOk or onCancel returns false
                if (!res) throw "cancelRouteChange"
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
