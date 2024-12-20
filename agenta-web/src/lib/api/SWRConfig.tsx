import {SWRConfig, type SWRConfiguration} from "swr"
import axios from "@/lib/api/assets/axiosConfig"

const config: SWRConfiguration = {
    fetcher: (
        url: string,
        options: {
            method?: "POST" | "GET" | "DELETE"
            body?: any
        } = {},
    ) => {
        switch (options.method) {
            case "POST":
                return axios.post(url, options.body).then((res) => res.data)
            case "DELETE":
                return axios.delete(url).then((res) => {
                    return res
                })
            default:
                return axios.get(url).then((res) => {
                    return res.data
                })
        }
    },
}

const AgSWRConfig = ({
    children,
    config: passedConfig = {},
}: {
    children: React.ReactNode
    config?: Partial<SWRConfiguration>
}) => {
    const mergedConfig = {...config, ...passedConfig}
    return <SWRConfig value={mergedConfig}>{children}</SWRConfig>
}

export default AgSWRConfig
