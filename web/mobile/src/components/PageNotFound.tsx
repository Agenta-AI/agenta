import {NotFoundScreen} from "@agenta/auth-ui"
import {useRouter} from "next/router"

import {PageTitle} from "@/components/PageTitle"

/** The app's "not found" page: the 404 route, and any page that refuses to show itself. */
export const PageNotFound = () => {
    const router = useRouter()

    return (
        <>
            <PageTitle title="Page not found" />
            <NotFoundScreen
                onBack={() => router.back()}
                path={router.asPath === "/404" ? undefined : router.asPath}
            />
        </>
    )
}
