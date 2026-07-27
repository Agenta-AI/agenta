import {useMemo} from "react"

import {SWRConfig, type SWRConfiguration} from "swr"

import axios from "@/oss/lib/api/assets/axiosConfig"

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

const EMPTY_CONFIG: SWRConfiguration = {}

const AgSWRConfig = ({children, config: passedConfig = EMPTY_CONFIG}: AgSWRConfigProps) => {
    // Stable identity so SWR's context consumers don't re-render per provider render
    const mergedConfig = useMemo(() => ({...config, ...passedConfig}), [passedConfig])
    return <SWRConfig value={mergedConfig}>{children}</SWRConfig>
}

export default AgSWRConfig
