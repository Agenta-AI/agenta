import useSWR from "swr"

import {fetchAppContainerURL} from "@/oss/services/api"

const useURI = (appId: string, variantId?: string) => {
    const fetcher = async () => {
        const url = await fetchAppContainerURL(appId, variantId)
        return `${url}/run`
    }

    const swr = useSWR(variantId ? ["uri"] : null, fetcher, {
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
    })

    return swr
}

export default useURI
