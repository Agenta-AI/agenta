import {SWRConfig, type SWRConfiguration} from "swr"
import axios from "@/lib/api/assets/axiosConfig"

const config: SWRConfiguration = {
    fetcher: (url: string) => axios.get(url).then((res) => res.data),
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
