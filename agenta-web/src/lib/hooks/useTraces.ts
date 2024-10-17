import {fetchAllTraces} from "@/services/observability/core"
import {_AgentaRootsResponse} from "@/services/observability/types"
import {useEffect, useState} from "react"

export const useTraces = () => {
    const [traces, setTraces] = useState<_AgentaRootsResponse[]>([])
    const [isLoadingTraces, setIsLoadingTraces] = useState(true)

    const fetchTraces = async () => {
        try {
            setIsLoadingTraces(true)
            const data = await fetchAllTraces()
            setTraces(data)
        } catch (error) {
            console.error(error)
        } finally {
            setIsLoadingTraces(false)
        }
    }

    useEffect(() => {
        fetchTraces()
    }, [])

    return {
        traces: traces,
        isLoadingTraces,
    }
}
