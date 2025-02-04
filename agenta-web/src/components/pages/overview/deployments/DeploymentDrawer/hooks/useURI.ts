import useSWR from "swr"

import {fetchAppContainerURL} from "@/services/api"

const useURI = (appId: string, variantId?: string) => {
    const fetcher = async () => {
        const url = await fetchAppContainerURL(appId, variantId)
        return `${url}/generate_deployed`
    }

    const swr = useSWR(!!variantId ? ["uri"] : null, fetcher, {
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
    })

    return swr
}

export default useURI
