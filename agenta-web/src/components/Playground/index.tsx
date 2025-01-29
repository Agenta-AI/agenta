import {useMemo} from "react"

import dynamic from "next/dynamic"
import {useRouter} from "next/router"
import useSWR from "swr"

import {getAgentaApiUrl} from "@/lib/helpers/utils"
import {ListAppsItem} from "@/lib/Types"

const NewPlayground = dynamic(() => import("../NewPlayground/Playground"), {ssr: false})
const OldPlayground = dynamic(() => import("../OldPlayground/Playground"), {ssr: false})

const PlaygroundRouter = () => {
    const router = useRouter()
    const appId = router.query.app_id
    const {isLoading, data} = useSWR(`${getAgentaApiUrl()}/api/apps`)

    const app = useMemo(() => {
        return (data || [])?.find((item: ListAppsItem) => item.app_id === appId)
    }, [appId, data])

    if (isLoading) {
        return <div>Loading...</div>
    } else if (!!app) {
        if (app.app_type?.includes(" (old)") || app.app_type === "custom") {
            return <OldPlayground />
        } else {
            if (!router.query.playground) {
                router.replace(
                    {query: {...router.query, playground: "new-playground"}},
                    undefined,
                    {shallow: true},
                )
            }
            return <NewPlayground />
        }
    } else {
        return null
    }
}

export default PlaygroundRouter
