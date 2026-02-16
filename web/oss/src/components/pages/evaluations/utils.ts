import {EvaluationRow} from "@/oss/components/HumanEvaluations/types"

type Nullable<T> = T | null | undefined

const pickString = (...values: unknown[]): string | undefined => {
    for (const value of values) {
        if (typeof value !== "string") continue
        const trimmed = value.trim()
        if (trimmed.length === 0) continue
        return trimmed
    }
    return undefined
}

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
    const invocationStep = dataSteps.find((step) => {
        if (!step) return false
        if (step?.type === "invocation") return true
        const refs = step.references ?? step ?? {}
        return Boolean(
            refs?.application ||
                refs?.applicationRevision ||
                refs?.application_revision ||
                refs?.applicationRef ||
                refs?.application_ref,
        )
    })
    if (!invocationStep) return null

    const references = invocationStep.references ?? invocationStep ?? {}
    const applicationRevision =
        references.applicationRevision || references.application_revision || references.revision
    const applicationRef =
        references.application ||
        applicationRevision?.application ||
        references.applicationRef ||
        references.application_ref
    const variantRef =
        references.variant ||
        references.variantRef ||
        references.variant_ref ||
        references.applicationVariant ||
        references.application_variant ||
        applicationRevision?.variant ||
        applicationRef?.variant

    const rawAppId = pickString(
        applicationRef?.id,
        applicationRef?.app_id,
        applicationRef?.appId,
        applicationRevision?.application_id,
        applicationRevision?.applicationId,
        references.application?.id,
        references.application?.app_id,
        references.application?.appId,
    )

    const rawAppName = pickString(
        applicationRef?.name,
        applicationRef?.slug,
        references.application?.name,
        references.application?.slug,
    )

    const rawVariantName = pickString(
        variantRef?.name,
        variantRef?.slug,
        variantRef?.variantName,
        variantRef?.variant_name,
        applicationRef?.variantName,
        applicationRef?.variant_name,
        references.application?.variantName,
        references.application?.variant_name,
        invocationStep.key,
    )

    const rawRevisionId = pickString(
        variantRef?.id,
        variantRef?.revisionId,
        variantRef?.revision_id,
        applicationRevision?.id,
        applicationRevision?.revisionId,
        applicationRevision?.revision_id,
    )

    const revisionLabel =
        pickString(
            variantRef?.version,
            variantRef?.revision,
            variantRef?.revisionLabel,
            applicationRevision?.revision,
            applicationRevision?.version,
            applicationRevision?.name,
        ) ?? null

    if (!rawAppId && !rawRevisionId && !rawVariantName) return null

    return {
        appId: rawAppId,
        appName: rawAppName,
        revisionId: rawRevisionId,
        variantName: rawVariantName,
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
    const variant = Array.isArray(variants) && variants.length ? variants[0] : undefined
    const metadataFromSteps = parseInvocationMetadata(evaluation)

    if (!variant && !metadataFromSteps) return null

    const variantDetails = variant
        ? {
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
        : undefined

    const resolved = {
        appId: metadataFromSteps?.appId ?? variantDetails?.appId,
        appName: metadataFromSteps?.appName ?? variantDetails?.appName,
        revisionId: variantDetails?.revisionId ?? metadataFromSteps?.revisionId,
        variantName: variantDetails?.variantName ?? metadataFromSteps?.variantName,
        revisionLabel: variantDetails?.revisionLabel ?? metadataFromSteps?.revisionLabel,
    }

    return resolved
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
