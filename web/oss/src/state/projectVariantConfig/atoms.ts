import {atom, getDefaultStore} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"
import {queryClientAtom} from "jotai-tanstack-query"

import {adaptRevisionToVariant} from "@/oss/lib/shared/variant"
import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types/transformedVariant"
import {
    RevisionObject,
    ParentVariantObject,
} from "@/oss/lib/shared/variant/transformer/types/variant"
import {fetchVariantConfig, VariantConfigResponse} from "@/oss/services/variantConfigs/api"
import {appsAtom} from "@/oss/state/app/selectors/app"

export interface ProjectVariantConfigKey {
    projectId?: string
    appId?: string
    appSlug?: string
    variantId?: string
    variantSlug?: string
    variantVersion?: number | null
}

export const serializeProjectVariantConfigKey = (key: ProjectVariantConfigKey): string =>
    JSON.stringify({
        projectId: key.projectId ?? "",
        appId: key.appId ?? "",
        appSlug: key.appSlug ?? "",
        variantId: key.variantId ?? "",
        variantSlug: key.variantSlug ?? "",
        variantVersion: key.variantVersion ?? null,
    })

const parseKey = (serialized: string): ProjectVariantConfigKey => {
    try {
        const parsed = JSON.parse(serialized)
        return {
            projectId: parsed.projectId || undefined,
            appId: parsed.appId || undefined,
            appSlug: parsed.appSlug || undefined,
            variantId: parsed.variantId || undefined,
            variantSlug: parsed.variantSlug || undefined,
            variantVersion: parsed.variantVersion ?? undefined,
        }
    } catch (error) {
        console.warn("Failed to parse project variant config key", error)
        return {}
    }
}

export const projectVariantConfigQueryFamily = atomFamily((serializedKey: string) =>
    atomWithQuery<VariantConfigResponse | null>((get) => {
        const params = parseKey(serializedKey)
        const {projectId, appId, appSlug, variantId, variantSlug, variantVersion} = params
        const enabled = Boolean(projectId) && (Boolean(variantId) || Boolean(variantSlug))

        return {
            queryKey: [
                "projectVariantConfig",
                projectId ?? "",
                appId ?? "",
                appSlug ?? "",
                variantId ?? "",
                variantSlug ?? "",
                variantVersion ?? "",
            ],
            queryFn: async () => {
                if (!enabled) return null
                return fetchVariantConfig({
                    projectId: projectId as string,
                    application: {
                        id: appId,
                        slug: appSlug,
                    },
                    variant: {
                        id: variantId,
                        slug: variantSlug,
                        version: variantVersion ?? null,
                    },
                })
            },
            refetchOnReconnect: false,
            refetchOnMount: false,
            refetchOnWindowFocus: false,
            staleTime: 60_000,
            enabled,
        }
    }),
)

const projectVariantReferenceMapAtom = atom<Map<string, ProjectVariantConfigKey>>(new Map())

export const projectVariantReferenceCountAtom = atom(
    (get) => get(projectVariantReferenceMapAtom).size,
)

export const setProjectVariantReferencesAtom = atom(
    null,
    (get, set, references: ProjectVariantConfigKey[]) => {
        const next = new Map<string, ProjectVariantConfigKey>()
        references.forEach((reference) => {
            if (!reference?.projectId) return
            const serialized = serializeProjectVariantConfigKey(reference)
            next.set(serialized, {
                projectId: reference.projectId,
                appId: reference.appId,
                appSlug: reference.appSlug,
                variantId: reference.variantId,
                variantSlug: reference.variantSlug,
                variantVersion: reference.variantVersion ?? null,
            })
        })
        set(projectVariantReferenceMapAtom, next)
    },
)

export interface ProjectScopedVariantsState {
    variants: EnhancedVariant[]
    revisionMap: Record<string, EnhancedVariant[]>
    specMap: Record<string, unknown | undefined>
    uriMap: Record<string, {runtimePrefix: string; routePath?: string} | undefined>
    isLoading: boolean
    revisions: EnhancedVariant[]
}

const buildRevisionFromConfig = (
    projectId: string,
    params: ProjectVariantConfigKey,
    response: VariantConfigResponse | null,
    appNameLookup: Map<string, string>,
): EnhancedVariant => {
    const variantId =
        response?.variant_ref?.id || params.variantId || params.variantSlug || "unknown"
    const variantSlug = response?.variant_ref?.slug || params.variantSlug || variantId
    const revisionValue = response?.variant_ref?.version ?? params.variantVersion ?? null
    const appId = response?.application_ref?.id || params.appId || ""
    const appSlug = response?.application_ref?.slug || params.appSlug || ""
    const appName = appNameLookup.get(appId) || appSlug
    const configParams = response?.params ? {...response.params} : undefined

    const revision: RevisionObject = {
        id: variantId,
        revision: revisionValue ?? "",
        config: {
            parameters: configParams ?? {},
        },
        createdAtTimestamp: Date.now(),
        updatedAtTimestamp: Date.now(),
        modifiedById: "",
        modifiedBy: null,
    }

    const parentVariant: ParentVariantObject = {
        variantId,
        variantName: variantSlug,
        configName: variantSlug,
        appId,
        baseId: variantId,
        baseName: variantSlug,
        parameters: configParams ?? {},
        createdAtTimestamp: Date.now(),
        updatedAtTimestamp: Date.now(),
    }

    const adapted = adaptRevisionToVariant(revision, parentVariant)

    return {
        ...adapted,
        appId,
        appName,
        projectId,
        uri: response?.url || "",
        configParams: configParams,
        revisionLabel: revisionValue ?? null,
    } as EnhancedVariant & {
        configParams?: Record<string, any>
        revisionLabel?: number | string | null
    }
}

export const projectScopedVariantsAtom = atom<ProjectScopedVariantsState>((get) => {
    const referenceMap = get(projectVariantReferenceMapAtom)

    if (referenceMap.size === 0) {
        return {
            variants: [],
            revisionMap: {},
            specMap: {},
            uriMap: {},
            isLoading: false,
            revisions: [],
        }
    }

    const apps = get(appsAtom) || []
    const appNameLookup = new Map(apps.map((item) => [item.app_id, item.app_name]))

    const variants: EnhancedVariant[] = []
    const revisionMap: Record<string, EnhancedVariant[]> = {}
    const uriMap: Record<string, {runtimePrefix: string; routePath?: string} | undefined> = {}
    const specMap: Record<string, unknown | undefined> = {}

    let isLoading = false

    referenceMap.forEach((params, serialized) => {
        if (!params.projectId) return
        const queryResult = get(projectVariantConfigQueryFamily(serialized))
        if (queryResult.isPending || queryResult.isLoading) {
            isLoading = true
        }
        const response = queryResult.data
        const enhanced = buildRevisionFromConfig(params.projectId, params, response, appNameLookup)

        variants.push(enhanced)
        const revisionList = revisionMap[enhanced.variantId] || []
        revisionList.push(enhanced)
        revisionMap[enhanced.variantId] = revisionList

        if (enhanced.uri) {
            uriMap[enhanced.variantId] = {
                runtimePrefix: enhanced.uri,
            }
        }
    })

    return {
        variants,
        revisionMap,
        specMap,
        uriMap,
        isLoading,
        revisions: variants.slice(),
    }
})

export const clearProjectVariantReferencesAtom = atom(null, (get, set) => {
    if (get(projectVariantReferenceMapAtom).size === 0) return
    set(projectVariantReferenceMapAtom, new Map())
})

export const projectVariantConfigQueryKey = "projectVariantConfig"

export const prefetchProjectVariantConfigs = (references: ProjectVariantConfigKey[]) => {
    if (!Array.isArray(references) || references.length === 0) return
    const store = getDefaultStore()
    const queryClient = store.get(queryClientAtom)
    references.forEach((reference) => {
        if (!reference?.projectId) return
        const serialized = serializeProjectVariantConfigKey(reference)
        const params = parseKey(serialized)
        if (!params.projectId || (!params.variantId && !params.variantSlug)) return

        queryClient
            .ensureQueryData({
                queryKey: [
                    projectVariantConfigQueryKey,
                    params.projectId ?? "",
                    params.appId ?? "",
                    params.appSlug ?? "",
                    params.variantId ?? "",
                    params.variantSlug ?? "",
                    params.variantVersion ?? "",
                ],
                queryFn: async () => {
                    return fetchVariantConfig({
                        projectId: params.projectId as string,
                        application: {
                            id: params.appId,
                            slug: params.appSlug,
                        },
                        variant: {
                            id: params.variantId,
                            slug: params.variantSlug,
                            version: params.variantVersion ?? null,
                        },
                    })
                },
            })
            .catch((error) => {
                if (process.env.NODE_ENV !== "production") {
                    console.error("[projectVariantConfig] prefetch error", error)
                }
            })
    })
}
