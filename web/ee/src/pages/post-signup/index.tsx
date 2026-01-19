import {useEffect} from "react"

import {useRouter} from "next/router"

import PostSignupForm from "@/oss/components/PostSignupForm/PostSignupForm"

export default function Apps() {
    const router = useRouter()

    console.log("[post-signup] page mount")

    useEffect(() => {
        const handleRouteChangeStart = (url: string) => {
            console.log("[post-signup] route change start", {from: router.asPath, to: url})
        }
        const handleRouteChangeComplete = (url: string) => {
            console.log("[post-signup] route change complete", {to: url})
        }

        router.events.on("routeChangeStart", handleRouteChangeStart)
        router.events.on("routeChangeComplete", handleRouteChangeComplete)

        return () => {
            router.events.off("routeChangeStart", handleRouteChangeStart)
            router.events.off("routeChangeComplete", handleRouteChangeComplete)
        }
    }, [router])

    return <PostSignupForm />
}
