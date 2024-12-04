import {type PropsWithChildren, useState, useCallback} from "react"
import {Typography, Button} from "antd"
import clsx from "clsx"
import useResizeObserver from "@/hooks/useResizeObserver"
import {createUseStyles} from "react-jss"
import {JSSTheme} from "@/lib/Types"
import {Transition} from "@headlessui/react"
import {useRouter} from "next/router"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    overlay: {
        background: `${theme.colorBgContainer}`,
    },
}))

// List of routes where the component should be displayed
const APP_ROUTES = [
    "/apps",
    "/observability",
    "/settings",
    "/testsets"
]

const NoMobilePageWrapper: React.FC<PropsWithChildren> = ({children}) => {
    const [dismissed, setDismissed] = useState(false)
    const [shouldDisplay, setShouldDisplay] = useState(false)
    const {overlay} = useStyles()
    const {pathname} = useRouter()

    const observerCallback = useCallback((bounds: DOMRectReadOnly) => {
        setShouldDisplay((prevShouldDisplay) => {
            if (dismissed) return false // keep hidden if already dismissed by the user
            if (!APP_ROUTES.some((route) => pathname.startsWith(route))) return false
            
            return bounds.width < 768
        })
    }, [dismissed, pathname])
    
    useResizeObserver(
        observerCallback,
        typeof window !== "undefined" ? document.body : undefined,
    )

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
