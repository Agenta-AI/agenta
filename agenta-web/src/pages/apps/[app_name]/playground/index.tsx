import {useRouter} from "next/router"
import {useEffect} from "react"
import {fetchVariants} from "@/lib/services/api"

export default function Logs() {
    const router = useRouter()
    const appName = router.query.app_name as unknown as string

    const fetchData = async () => {
        try {
            const backendVariants = await fetchVariants(appName)
            if (backendVariants.length > 0) {
                router.push([router.asPath, backendVariants[0].variantName].join("/"))
            }
        } catch (_) {}
    }

    useEffect(() => {
        fetchData()
    }, [appName])
}
