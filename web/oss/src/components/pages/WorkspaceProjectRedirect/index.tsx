import {useEffect} from "react"

import {NotFoundScreen} from "@agenta/auth-ui"
import {Spin} from "antd"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import useURL from "@/oss/hooks/useURL"
import {workspaceContextAtom} from "@/oss/state/project"

const WorkspaceProjectRedirect = () => {
    const router = useRouter()
    const {baseAppURL} = useURL()
    const {isNotFound} = useAtomValue(workspaceContextAtom)

    useEffect(() => {
        if (!router.isReady) return
        if (!baseAppURL) return
        if (router.asPath !== baseAppURL) {
            router.replace(baseAppURL)
        }
    }, [router, baseAppURL])

    // Same dead end as `/w/:id`, one segment deeper: nothing resolves, so nothing ever moves.
    if (isNotFound) {
        return <NotFoundScreen onBack={() => router.back()} path={router.asPath} />
    }

    return (
        <section className="flex items-center justify-center w-full h-screen">
            <Spin spinning={true} />
        </section>
    )
}

export default WorkspaceProjectRedirect
