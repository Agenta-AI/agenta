import {ProjectVariantConfigKey} from "@/oss/state/projectVariantConfig"

interface InvocationReference {
    appId?: string
    appSlug?: string
    revisionId?: string
    revisionVersion?: number | null
    variantSlug?: string
    fallbackKey?: string
}

const normalizeReference = (refs: any, fallbackKey?: string): InvocationReference | null => {
    if (!refs) return null

    const applicationRevision =
        refs.applicationRevision || refs.application_revision || refs.application_ref?.revision
    const applicationRef =
        refs.application ||
        applicationRevision?.application ||
        refs.application_ref ||
        refs.applicationRef
    const variantRef = refs.variant || refs.variant_ref || refs.variantRef

    const appId =
        applicationRef?.id ||
        applicationRevision?.application_id ||
        applicationRevision?.applicationId
    const appSlug = applicationRef?.slug || applicationRef?.name

    const revisionId =
        applicationRevision?.id ||
        applicationRevision?.revisionId ||
        applicationRevision?.revision_id ||
        variantRef?.id ||
        variantRef?.revisionId ||
        variantRef?.revision_id
    const revisionVersion =
        applicationRevision?.revision ??
        applicationRevision?.version ??
        variantRef?.version ??
        variantRef?.revision
    let variantSlug =
        variantRef?.slug || variantRef?.name || variantRef?.variantName || variantRef?.variant_name

    if (!variantSlug) {
        variantSlug =
            refs.application?.slug ||
            refs.application?.name ||
            refs.applicationRef?.slug ||
            refs.applicationRef?.name ||
            fallbackKey
    }

    if (!appId && !appSlug) return null

    return {
        appId,
        appSlug,
        revisionId: revisionId || fallbackKey,
        revisionVersion,
        variantSlug: variantSlug || fallbackKey,
        fallbackKey,
    }
}

const extractInvocationReference = (run: any): InvocationReference | null => {
    const steps: any[] = run?.data?.steps || []
    const invocationStep = steps.find((step: any) => {
        if (step?.type === "invocation") return true
        const refs = step?.references ?? step
        return Boolean(
            refs?.application ||
            refs?.applicationRevision ||
            refs?.application_revision ||
            refs?.applicationRef ||
            refs?.application_ref,
        )
    })

    if (!invocationStep) return null
    const refs = invocationStep.references ?? invocationStep
    return normalizeReference(refs, invocationStep.key)
}

export const collectProjectVariantReferences = (
    runs: any[],
    projectId?: string,
): ProjectVariantConfigKey[] => {
    if (!Array.isArray(runs) || !projectId) return []
    const collected = new Map<string, ProjectVariantConfigKey>()

    runs.forEach((run) => {
        const invocation = extractInvocationReference(run)
        let reference: ProjectVariantConfigKey | undefined

        if (invocation) {
            reference = {
                projectId,
                appId: invocation.appId,
                appSlug: invocation.appSlug,
                variantId: invocation.revisionId,
                variantSlug: invocation.variantSlug,
                variantVersion: invocation.revisionVersion ?? null,
            }
        } else if (Array.isArray((run as any)?.variants) && (run as any).variants.length) {
            const variant = (run as any).variants[0]
            reference = {
                projectId,
                appId: variant?.appId || variant?.app_id,
                appSlug: variant?.appSlug || variant?.app_slug,
                variantId: variant?.id || variant?.revisionId || variant?.revision_id,
                variantSlug:
                    variant?.variantSlug || variant?.variantName || variant?.slug || variant?.name,
                variantVersion:
                    (variant?.revision as number | null | undefined) ??
                    (variant?.revisionLabel as number | string | null | undefined) ??
                    null,
            }
        }

        if (!reference) return
        if (!reference.variantId && !reference.variantSlug) return

        const key = JSON.stringify(reference)
        if (!collected.has(key)) {
            collected.set(key, reference)
        }
    })

    return Array.from(collected.values())
}
