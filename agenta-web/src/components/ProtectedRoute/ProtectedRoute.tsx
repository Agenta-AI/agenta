import {useSession} from "@/hooks/useSession"
import {useRouter} from "next/router"
import React, {PropsWithChildren, useEffect, useState} from "react"

const ProtectedRoute: React.FC<PropsWithChildren> = ({children}) => {
    const router = useRouter()
    const {loading, doesSessionExist: isSignedIn} = useSession()
    const {pathname} = router
    const [shouldRender, setShouldRender] = useState(false)

    useEffect(() => {
        if (loading) {
            setShouldRender(false)
        } else {
            if (pathname.startsWith("/auth")) {
                if (isSignedIn) {
                    router.push("/apps")
                }
                setShouldRender(!isSignedIn)
            } else {
                if (!isSignedIn) {
                    router.push(
                        `/auth?redirectToPath=${encodeURIComponent(
                            `${pathname}${window.location.search}`,
                        )}`,
                    )
                }
                setShouldRender(isSignedIn)
            }
        }
    }, [pathname, isSignedIn, loading])

    return <>{shouldRender ? children : null}</>
}

export default ProtectedRoute
