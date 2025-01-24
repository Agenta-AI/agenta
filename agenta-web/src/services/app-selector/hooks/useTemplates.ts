import {useState} from "react"
import isEqual from "lodash/isEqual"
import useSWR, {SWRConfiguration} from "swr"

import {getAgentaApiUrl} from "@/lib/helpers/utils"

const useTemplates = (config?: SWRConfiguration) => {
    const [noTemplateMessage, setNoTemplateMessage] = useState("")
    const swr = useSWR(`${getAgentaApiUrl()}/api/containers/templates`, {
        ...config,
        compare(a, b) {
            if (!!a && !!b && a.length === b.length) {
                return true
            } else {
                return isEqual(a, b)
            }
        },
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
        revalidateIfStale: false, // Disable revalidation if data is stale
        onSuccess: (data) => {
            if (typeof data !== "object") {
                setNoTemplateMessage(data)
            }
        },
    })

    return [swr, noTemplateMessage] as const
}

export default useTemplates
