import {EvaluationRow} from "@/oss/components/HumanEvaluations/types"

type Nullable<T> = T | null | undefined

const parseInvocationMetadata = (
    evaluation: EvaluationRow,
): {
    appId?: string
    appName?: string
    revisionId?: string
    variantName?: string
    revisionLabel?: string | number
} | null => {
    const dataSteps: any[] = (evaluation as any)?.data?.steps || []
    const invocationStep = dataSteps.find((step) => step?.type === "invocation")
    if (!invocationStep) return null

    const references = invocationStep.references ?? invocationStep ?? {}
    const applicationRevision =
        references.applicationRevision || references.application_revision || references.revision
    const applicationRef =
        references.application ||
        applicationRevision?.application ||
        references.applicationRef ||
        references.application_ref
    const variantRef = references.variant || references.variantRef || references.variant_ref

    const rawAppId =
        applicationRef?.id ||
        applicationRef?.app_id ||
        applicationRef?.appId ||
        references.application?.id ||
        references.application?.app_id ||
        applicationRevision?.application_id ||
        applicationRevision?.applicationId

    const rawAppName =
        applicationRef?.name ||
        applicationRef?.slug ||
        references.application?.name ||
        references.application?.slug

    const rawVariantName =
        variantRef?.name ||
        variantRef?.slug ||
        variantRef?.variantName ||
        variantRef?.variant_name ||
        applicationRef?.name ||
        applicationRef?.slug ||
        references.application?.name ||
        references.application?.slug ||
        invocationStep.key

    const rawRevisionId =
        variantRef?.id ||
        variantRef?.revisionId ||
        variantRef?.revision_id ||
        applicationRevision?.id ||
        applicationRevision?.revisionId ||
        applicationRevision?.revision_id

    const revisionLabel =
        variantRef?.version ??
        variantRef?.revision ??
        variantRef?.revisionLabel ??
        applicationRevision?.revision ??
        applicationRevision?.version ??
        applicationRevision?.name ??
        null

    if (!rawAppId && !rawRevisionId && !rawVariantName) return null

    return {
        appId: typeof rawAppId === "string" ? rawAppId : undefined,
        appName: typeof rawAppName === "string" ? rawAppName : undefined,
        revisionId: typeof rawRevisionId === "string" ? rawRevisionId : undefined,
        variantName: typeof rawVariantName === "string" ? rawVariantName : undefined,
        revisionLabel: revisionLabel ?? undefined,
    }
}

export const extractPrimaryInvocation = (
    evaluation: EvaluationRow,
): {
    appId?: string
    appName?: string
    revisionId?: string
    variantName?: string
    revisionLabel?: string | number
} | null => {
    if (!evaluation) return null

    const variants = (evaluation as any)?.variants
    if (Array.isArray(variants) && variants.length) {
        const variant = variants[0]
        return {
            appId:
                variant?.appId ||
                (typeof variant?.app_id === "string" ? variant.app_id : undefined) ||
                (typeof variant?.applicationId === "string" ? variant.applicationId : undefined),
            appName: (variant as any)?.appName || (variant as any)?.appSlug,
            revisionId:
                (variant as any)?.id ||
                (typeof variant?.revisionId === "string" ? variant.revisionId : undefined) ||
                (typeof variant?.revision_id === "string" ? variant.revision_id : undefined),
            variantName: variant?.variantName || variant?.name || (variant as any)?.slug,
            revisionLabel:
                (variant as any)?.revisionLabel ||
                (variant as any)?.revision ||
                (variant as any)?.version,
        }
    }

    return parseInvocationMetadata(evaluation)
}

export const extractEvaluationAppId = (evaluation: EvaluationRow): string | undefined => {
    const invocation = extractPrimaryInvocation(evaluation)
    if (invocation?.appId) return invocation.appId

    const directAppId: Nullable<string> = (evaluation as any)?.appId
    if (typeof directAppId === "string" && directAppId.length > 0) {
        return directAppId
    }

    const variants = (evaluation as any)?.variants
    if (Array.isArray(variants) && variants.length) {
        const candidate = variants[0]
        const variantAppId =
            (typeof candidate?.appId === "string" &&
                candidate.appId.length > 0 &&
                candidate.appId) ||
            (typeof candidate?.app_id === "string" &&
                candidate.app_id.length > 0 &&
                candidate.app_id) ||
            (typeof candidate?.applicationId === "string" &&
                candidate.applicationId.length > 0 &&
                candidate.applicationId)
        if (variantAppId) return variantAppId
    }

    return undefined
}

export const getCommonEvaluationAppId = (evaluations: EvaluationRow[]): string | undefined => {
    if (!Array.isArray(evaluations) || evaluations.length === 0) return undefined
    const ids = new Set(
        evaluations
            .map((evaluation) => extractEvaluationAppId(evaluation))
            .filter((id): id is string => Boolean(id)),
    )

    if (ids.size !== 1) return undefined
    const [only] = Array.from(ids)
    return only
}

export const buildAppScopedUrl = (baseAppURL: string, appId: string, path: string): string => {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`
    return `${baseAppURL}/${encodeURIComponent(appId)}${normalizedPath}`
}

export const buildProjectEvaluationUrl = (projectURL: string, path: string): string => {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`
    return `${projectURL}${normalizedPath}`
}

export const buildEvaluationNavigationUrl = ({
    scope,
    baseAppURL,
    projectURL,
    appId,
    path,
}: {
    scope: "app" | "project"
    baseAppURL: string
    projectURL: string
    appId?: string
    path: string
}) => {
    if (scope === "app" && appId) {
        return buildAppScopedUrl(baseAppURL, appId, path)
    }
    return buildProjectEvaluationUrl(projectURL, path)
}
