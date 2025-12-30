import {useMemo} from "react"

import useURL from "@/oss/hooks/useURL"
import {buildRevisionsQueryParam} from "@/oss/lib/helpers/url"

import useRunIdentifiers from "./useRunIdentifiers"

export interface RunScopedUrls {
    projectURL: string | null
    baseAppURL: string | null
    applicationId: string | null
    appDetailHref: string | null
    buildAppPathHref: (path?: string | null) => string | null
    buildVariantPlaygroundHref: (
        variantId?: string | null,
        options?: {revisions?: string[]},
    ) => string | null
    buildRevisionPlaygroundHref: (
        variantId?: string | null,
        revisionId?: string | null,
    ) => string | null
    buildTestsetHref: (testsetId?: string | null) => string | null
}

const normalizeBase = (value?: string | null) => {
    if (!value) return null
    return value.trim() ? value : null
}

const ensurePrefixedPath = (base: string, path?: string | null) => {
    if (!path) return base
    return path.startsWith("/") ? `${base}${path}` : `${base}/${path}`
}

const useRunScopedUrls = (
    runId?: string | null,
    overrideApplicationId?: string | null,
): RunScopedUrls => {
    const {projectURL: routerProjectURL, baseAppURL: routerBaseAppURL} = useURL()
    const {applicationId: runApplicationId} = useRunIdentifiers(runId)

    const projectURL = normalizeBase(routerProjectURL)
    const baseAppURL = normalizeBase(routerBaseAppURL) ?? (projectURL ? `${projectURL}/apps` : null)
    const applicationId = overrideApplicationId ?? runApplicationId ?? null

    return useMemo(() => {
        const appDetailHref =
            applicationId && projectURL
                ? `${projectURL}/apps/${encodeURIComponent(applicationId)}`
                : null

        const buildAppPathHref = (path?: string | null) => {
            if (!applicationId || !baseAppURL) return null
            const appBase = `${baseAppURL}/${encodeURIComponent(applicationId)}`
            return ensurePrefixedPath(appBase, path)
        }

        const buildVariantPlaygroundHref = (
            variantId?: string | null,
            options?: {revisions?: string[]},
        ) => {
            if (!variantId) return null
            const base = buildAppPathHref("playground")
            if (!base) return null

            const revisions = options?.revisions ?? (variantId ? [variantId] : [])
            const revisionsParam = buildRevisionsQueryParam(revisions)
            if (!revisionsParam) return base

            const params = new URLSearchParams({
                revisions: revisionsParam,
            })
            return `${base}?${params.toString()}`
        }

        const buildRevisionPlaygroundHref = (
            variantId?: string | null,
            revisionId?: string | null,
        ) => {
            // Use revisionId if available, otherwise fall back to variantId
            const targetId = revisionId ?? variantId
            if (!targetId) return null
            const base = buildAppPathHref("playground")
            if (!base) return null

            const revisionsParam = buildRevisionsQueryParam([targetId])
            if (!revisionsParam) return base

            const params = new URLSearchParams({
                revisions: revisionsParam,
            })
            return `${base}?${params.toString()}`
        }

        const buildTestsetHref = (testsetId?: string | null) => {
            if (!testsetId || !projectURL) return null
            return `${projectURL}/testsets/${encodeURIComponent(testsetId)}`
        }

        return {
            projectURL,
            baseAppURL,
            applicationId,
            appDetailHref,
            buildAppPathHref,
            buildVariantPlaygroundHref,
            buildRevisionPlaygroundHref,
            buildTestsetHref,
        }
    }, [applicationId, baseAppURL, projectURL])
}

export default useRunScopedUrls
