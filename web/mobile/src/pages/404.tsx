import {NotFoundScreen} from "@agenta/auth-ui"
import Head from "next/head"
import {useRouter} from "next/router"

export default function NotFound() {
    const router = useRouter()

    return (
        <>
            <Head>
                <title>Page not found · Agenta</title>
            </Head>
            <NotFoundScreen
                onBack={() => router.back()}
                path={router.asPath === "/404" ? undefined : router.asPath}
            />
        </>
    )
}
