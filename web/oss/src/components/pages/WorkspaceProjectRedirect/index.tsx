import {useEffect} from "react"

import {Spinner} from "@agenta/primitive-ui/components/spinner"
import {useRouter} from "next/router"

import useURL from "@/oss/hooks/useURL"

const WorkspaceProjectRedirect = () => {
    const router = useRouter()
    const {baseAppURL} = useURL()

    useEffect(() => {
        if (!router.isReady) return
        if (!baseAppURL) return
        if (router.asPath !== baseAppURL) {
            router.replace(baseAppURL)
        }
    }, [router, baseAppURL])

    if (baseAppURL && router.asPath === baseAppURL) {
        return null
    }

    return (
        <section className="flex items-center justify-center w-full h-screen">
            <Spinner />
        </section>
    )
}

export default WorkspaceProjectRedirect
