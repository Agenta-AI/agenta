import {useCallback} from "react"

import useSWR from "swr"

import {fetchAppContainerURL} from "@/oss/services/api"

const useURI = (appId: string, variantId?: string) => {
    const fetcher = useCallback(async () => {
        const url = await fetchAppContainerURL(appId, variantId)
        return `${url}/run`
    }, [])

    const swr = useSWR(variantId ? ["uri"] : null, fetcher)

    return swr
}

export default useURI
