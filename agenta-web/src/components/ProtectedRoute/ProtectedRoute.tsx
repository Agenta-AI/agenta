import {useSession} from "@/hooks/useSession"
import {useRouter} from "next/router"
import React, {PropsWithChildren, useEffect, useState} from "react"
import {useProjectData} from "@/contexts/project.context"

const ProtectedRoute: React.FC<PropsWithChildren> = ({children}) => {
    const router = useRouter()
    const {loading, doesSessionExist: isSignedIn} = useSession()
    const {pathname} = router
    const [shouldRender, setShouldRender] = useState(false)
    const {isLoading, isProjectId} = useProjectData()

    useEffect(() => {
        if (loading || isLoading) {
            setShouldRender(false)
        } else {
            if (pathname.startsWith("/auth")) {
                if (isSignedIn) {
                    router.push("/apps")
                }
                setShouldRender(true)
            } else {
                if (!isSignedIn) {
                    router.push(
                        `/auth?redirectToPath=${encodeURIComponent(
                            `${pathname}${window.location.search}`,
                        )}`,
                    )
                }
                setShouldRender(!!isProjectId)
            }
        }
    }, [pathname, isSignedIn, loading, isProjectId, isLoading])

    return <>{shouldRender ? children : null}</>
}

export default ProtectedRoute
