import {NotFoundScreen} from "@agenta/auth-ui"
import {useRouter} from "next/router"

// `Layout` keeps /404 out of the app shell, so it reads the same signed in or out.
const NotFound = () => {
    const router = useRouter()

    return (
        <NotFoundScreen
            onBack={() => router.back()}
            path={router.asPath === "/404" ? undefined : router.asPath}
        />
    )
}

export default NotFound
