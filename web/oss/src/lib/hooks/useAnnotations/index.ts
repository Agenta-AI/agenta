import useSWR from "swr"

import {useOrgData} from "@/oss/contexts/org.context"
import {getCurrentProject} from "@/oss/contexts/project.context"
import {queryAllAnnotations} from "@/oss/services/annotations/api"

import {annotationsTransformer} from "./assets/transformer"
import {AnnotationsResponse} from "./types"

const useAnnotations = () => {
    const {selectedOrg} = useOrgData()
    const {projectId} = getCurrentProject()
    const workspace = selectedOrg?.default_workspace
    const members = workspace?.members || []

    const fetcher = async () => {
        const data = await queryAllAnnotations()

        return (
            data?.annotations.map((annotation) => annotationsTransformer(annotation, members)) || []
        )
    }

    const swr = useSWR(`/api/preview/annotations/?project_id=${projectId}`, fetcher, {
        revalidateOnFocus: false,
        shouldRetryOnError: false,
    })

    return swr
}

export default useAnnotations
