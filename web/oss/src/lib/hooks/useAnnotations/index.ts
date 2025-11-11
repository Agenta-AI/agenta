import useSWR from "swr"

import {useOrgData} from "@/oss/contexts/org.context"
import {getCurrentProject} from "@/oss/contexts/project.context"
import {queryAllAnnotations} from "@/oss/services/annotations/api"

import {transformApiData} from "./assets/transformer"
import {AnnotationDto} from "./types"

const useAnnotations = (queries?: {annotation: Record<string, any>}) => {
    const {selectedOrg} = useOrgData()
    const {projectId} = getCurrentProject()
    const workspace = selectedOrg?.default_workspace
    const members = workspace?.members || []

    const fetcher = async () => {
        const data = await queryAllAnnotations(queries)

        return (
            data?.annotations.map((annotation) =>
                transformApiData<AnnotationDto>({data: annotation, members}),
            ) || []
        )
    }

    const swr = useSWR(`/api/preview/annotations/?project_id=${projectId}`, fetcher, {
        revalidateOnFocus: false,
        shouldRetryOnError: false,
    })

    return swr
}

export default useAnnotations
