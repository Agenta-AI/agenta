import {NotFoundScreen} from "@agenta/auth-ui"
import {useRouter} from "next/router"

// Full-screen and signed-out: `Layout` keeps /404 out of the app shell, so a bad link
// resolves the same whether or not the visitor has a session.
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
