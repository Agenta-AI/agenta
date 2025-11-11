import useSWR from "swr"

import {queryAllAnnotations} from "@/oss/services/annotations/api"
import {useOrganizationData} from "@/oss/state/organization"
import {getProjectValues} from "@/oss/state/project"

import {transformApiData} from "./assets/transformer"
import {AnnotationDto} from "./types"

const useAnnotations = ({
    queries,
    waitUntil = false,
}: {
    queries?: Record<string, any>
    waitUntil?: boolean
} = {}) => {
    const {selectedOrganization} = useOrganizationData()
    const {projectId} = getProjectValues()
    const workspace = selectedOrganization?.default_workspace
    const members = workspace?.members || []

    const fetcher = async () => {
        const data = await queryAllAnnotations(queries)

        return (
            data?.annotations.map((annotation) =>
                transformApiData<AnnotationDto>({data: annotation, members}),
            ) || []
        )
    }

    const swrKey = waitUntil
        ? null
        : [`/preview/annotations/?project_id=${projectId}`, JSON.stringify(queries)]

    const swr = useSWR(swrKey, fetcher, {
        revalidateOnFocus: false,
        shouldRetryOnError: false,
    })

    return swr
}

export default useAnnotations
