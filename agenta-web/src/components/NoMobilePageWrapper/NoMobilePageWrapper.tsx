import {type PropsWithChildren, useState, useCallback} from "react"
import {Typography, Button, theme} from "antd"
import clsx from "clsx"
import useResizeObserver from "@/hooks/useResizeObserver"
import {createUseStyles} from "react-jss"
import {JSSTheme} from "@/lib/Types"
import {Transition} from "@headlessui/react"
import {useRouter} from "next/router"
import {MOBILE_UNOPTIMIZED_APP_ROUTES} from "./assets/constants"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    overlay: {
        background: `${theme.colorBgContainer}`,
    },
}))

const {useToken} = theme

const NoMobilePageWrapper: React.FC<PropsWithChildren> = ({children}) => {
    const [dismissed, setDismissed] = useState(false)
    const [shouldDisplay, setShouldDisplay] = useState(false)
    const {overlay} = useStyles()
    const {pathname} = useRouter()
    const {token} = useToken()

    const observerCallback = useCallback(
        (bounds: DOMRectReadOnly) => {
            setShouldDisplay(() => {
                if (dismissed) return false // keep hidden if already dismissed by the user
                if (!MOBILE_UNOPTIMIZED_APP_ROUTES.some((route) => pathname.startsWith(route)))
                    return false

                return bounds.width < token.screenMD
            })
        },
        [dismissed, pathname, token.screenMD],
    )

    useResizeObserver(observerCallback, typeof window !== "undefined" ? document.body : undefined)

    const handleDismiss = () => {
        setDismissed(true)
    }

    return (
        <Transition
            show={!dismissed && shouldDisplay}
            enter="transition-opacity duration-75"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="transition-opacity duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
            as="div"
            className={clsx([
                "fixed top-0 left-0 right-0 bottom-0", // overlay the entire screen
                "flex flex-col items-center justify-center gap-4", // flex config
                "z-[9999]",
                overlay, // TODO: better theme connected tailwind color classes
            ])}
            unmount
        >
            <Typography.Text className="w-8/12 text-center leading-1 text-lg">
                Agenta works better in larger laptop or desktop screens.
            </Typography.Text>
            <Button type="primary" size="large" onClick={handleDismiss}>
                View anyway
            </Button>
        </Transition>
    )
}

export default NoMobilePageWrapper
