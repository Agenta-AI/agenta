import {useEffect} from "react"

import {Spin} from "antd"
import {useRouter} from "next/router"

import useURL from "@/oss/hooks/useURL"

const WorkspaceRedirect = () => {
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
            <Spin spinning={true} />
        </section>
    )
}

export default WorkspaceRedirect
