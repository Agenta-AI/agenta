import {NotFoundScreen} from "@agenta/auth-ui"
import {useRouter} from "next/router"

import {PageTitle} from "@/components/PageTitle"

export default function NotFound() {
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
