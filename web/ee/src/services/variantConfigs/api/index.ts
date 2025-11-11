import axios from "@/oss/lib/api/assets/axiosConfig"

export interface VariantReferenceRequest {
    projectId: string
    application: {
        id?: string
        slug?: string
    }
    variant: {
        id?: string
        slug?: string
        version?: number | null
    }
}

export interface VariantConfigResponse {
    params?: Record<string, any>
    url?: string | null
    application_ref?: {
        id?: string
        slug?: string
    }
    variant_ref?: {
        id?: string
        slug?: string
        version?: number | null
    }
    service_ref?: {
        id?: string
        slug?: string
        version?: number | null
    }
}

const isEmpty = (obj: Record<string, unknown>) =>
    Object.values(obj).every((value) => value === undefined || value === null)

export const fetchVariantConfig = async ({
    projectId,
    application,
    variant,
}: VariantReferenceRequest): Promise<VariantConfigResponse | null> => {
    if (!projectId) {
        throw new Error("Project id is required to fetch variant config")
    }

    const payload: Record<string, unknown> = {}

    if (!isEmpty(application)) {
        payload.application_ref = application
    }

    if (!isEmpty(variant)) {
        payload.variant_ref = variant
    }

    if (!payload.variant_ref) {
        throw new Error("Variant reference is required to fetch variant config")
    }

    try {
        const response = await axios.post(
            `/variants/configs/fetch?project_id=${projectId}`,
            payload,
            {
                _ignoreError: true,
            } as any,
        )

        return (response.data as VariantConfigResponse) ?? null
    } catch (error: any) {
        if (error?.response?.status === 404) {
            return null
        }
        throw error
    }
}
