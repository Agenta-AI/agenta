import AlertPopup, {AlertPopupProps} from "@/components/AlertPopup/AlertPopup"
import Router from "next/router"
import {useEffect, useState} from "react"

const useBlockNavigation = (blocking: boolean, props: AlertPopupProps) => {
    // whether the popup has been opened
    const [opened, setOpened] = useState(false)

    useEffect(() => {
        if (blocking && !opened) {
            // prevent from reload or closing tab
            window.onbeforeunload = () => true

            const handler = (newRoute: string) => {
                setOpened(true)
                AlertPopup({
                    ...props,
                    onOk: async () => {
                        if (props.onOk) {
                            const res = await props.onOk()
                            if (res) {
                                Router.push(newRoute)
                            } else {
                                setOpened(false)
                            }
                        } else {
                            Router.push(newRoute)
                        }
                    },
                    onCancel: async () => {
                        if (props.onCancel) {
                            const res = await props.onCancel()
                            if (res) {
                                Router.push(newRoute)
                            } else {
                                setOpened(false)
                            }
                        } else {
                            Router.push(newRoute)
                        }
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
        }
    }, [blocking, props, opened])
}

export default useBlockNavigation
