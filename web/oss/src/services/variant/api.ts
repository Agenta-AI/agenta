import axios from "@/oss/lib/api/assets/axiosConfig"
import type {ApiVariant, VariantRevision} from "@/oss/lib/Types"

export const fetchAppVariants = async (appId: string, projectId?: string) => {
    const {data} = await axios.get<ApiVariant[]>(`/api/apps/${appId}/variants`, {
        params: {
            project_id: projectId,
            v: 2,
        },
    })
    return data
}

export const fetchVariantRevisions = async (variantId: string) => {
    const {data} = await axios.get<VariantRevision[]>(`/api/variants/${variantId}/revisions`)
    return data
}
