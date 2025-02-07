import {SWRConfig, type SWRConfiguration} from "swr"
import axios from "@/lib/api/assets/axiosConfig"
import {SWRDevTools} from "swr-devtools"
import {type AgentaFetcher, type FetcherOptions, type AgSWRConfigProps} from "./types"

const config: SWRConfiguration = {
    fetcher: ((url: string, options: FetcherOptions = {}) => {
        switch (options.method) {
            case "POST":
                return axios.post(url, options.body).then((res) => res.data)
            case "PUT":
                return axios.put(url, options.body).then((res) => {
                    return res.data
                })
            case "DELETE":
                return axios.delete(url).then((res) => {
                    return res
                })
            default:
                return axios.get(url, options).then((res) => {
                    return res.data
                })
        }
    }) as AgentaFetcher,
}

const AgSWRConfig = ({children, config: passedConfig = {}}: AgSWRConfigProps) => {
    const mergedConfig = {...config, ...passedConfig}
    return (
        <SWRDevTools>
            <SWRConfig value={mergedConfig}>{children}</SWRConfig>
        </SWRDevTools>
    )
}

export default AgSWRConfig
