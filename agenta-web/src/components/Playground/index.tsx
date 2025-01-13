import { useCallback, useState } from "react"

import dynamic from 'next/dynamic'
import { useRouter } from "next/router"
import useSWR from "swr"

import { getAgentaApiUrl } from "@/lib/helpers/utils"
import { ListAppsItem } from "@/lib/Types"

const NewPlayground = dynamic(() => import("../NewPlayground/Playground"), { ssr: false })
const OldPlayground = dynamic(() => import("../OldPlayground/Playground"), { ssr: false })

const PlaygroundRouter = () => {
    const router = useRouter()
    const appId = router.query.app_id
    const [app, setApp] = useState<ListAppsItem | null>(null)
    const {isLoading} = useSWR(`${getAgentaApiUrl()}/api/apps`, {
        onSuccess: useCallback((data) => {
            const _app = data.find((app) => app.app_id === appId)
            setApp(_app)
        }, [appId])
    })
    
    if (isLoading) {
        return <div>Loading...</div>
    } else if (!!app) {
        if (app.app_type?.includes('(old)')) {
            return <OldPlayground />
        } else {
            return <NewPlayground />
        }
    } else {
        router.push('/apps')
        return null
    }
}

export default PlaygroundRouter