import {SWRConfiguration} from "swr"

export interface FetcherOptions {
    method?: "POST" | "GET" | "DELETE" | "PUT"
    body?: any
    headers?: Record<string, string>
}

export type AgentaFetcher = (url: string, options?: FetcherOptions) => Promise<any>

export interface AgSWRConfigProps {
    children: React.ReactNode
    config?: Partial<SWRConfiguration>
}
