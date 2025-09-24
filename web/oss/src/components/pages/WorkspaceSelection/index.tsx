import {useEffect} from "react"

import {Spin} from "antd"
import {useRouter} from "next/router"

import useURL from "@/oss/hooks/useURL"

const WorkspaceSelection = () => {
    const router = useRouter()
    const {workspaceId, baseAppURL} = useURL()

    useEffect(() => {
        if (!router.isReady) return

        if (workspaceId && baseAppURL && router.asPath !== baseAppURL) {
            router.replace(baseAppURL)
            return
        }

        if (!workspaceId || !baseAppURL) return

        if (router.asPath !== baseAppURL) {
            router.replace(baseAppURL)
        }
    }, [router, workspaceId, baseAppURL])

    return (
        <section className="flex items-center justify-center w-full h-screen">
            <Spin spinning={true} />
        </section>
    )
}

export default WorkspaceSelection
