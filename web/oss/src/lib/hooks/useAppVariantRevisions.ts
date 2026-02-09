import {useMemo} from "react"

import {useQuery} from "@tanstack/react-query"
import {useAtomValue} from "jotai"

import {formatDay, parseDate} from "@/oss/lib/helpers/dateTimeHelper"
import {adaptRevisionToVariant} from "@/oss/lib/shared/variant"
import {fetchRevisions} from "@/oss/lib/shared/variant/api"
import type {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import type {
    ParentVariantObject,
    RevisionObject,
} from "@/oss/lib/shared/variant/transformer/types/variant"
import type {Variant, ApiRevision} from "@/oss/lib/Types"
import {fetchVariants} from "@/oss/services/api"
import {projectIdAtom} from "@/oss/state/project/selectors/project"

const REVISION_INPUT_FORMAT = "YYYY-MM-DD HH:mm:ss.SSSZ"

const toParentVariant = (variant: Variant): ParentVariantObject => ({
    id: variant.variantId,
    variantId: variant.variantId,
    variantName: variant.variantName,
    baseId: variant.baseId,
    baseName: variant.baseName,
    configName: variant.configName,
    appId: variant.appId,
    uri: variant.uri,
    parameters: variant.parameters,
    createdAtTimestamp: variant.createdAtTimestamp,
    updatedAtTimestamp: variant.updatedAtTimestamp,
    modifiedBy: variant.modifiedBy,
})

const toRevisionObject = (revision: ApiRevision): RevisionObject => {
    const parsedCreated = parseDate({date: revision.created_at, inputFormat: REVISION_INPUT_FORMAT})
    return {
        id: revision.id,
        revision: revision.revision,
        config: revision.config,
        createdAt: formatDay({
            date: revision.created_at,
            inputFormat: REVISION_INPUT_FORMAT,
            outputFormat: "DD MMM YYYY | h:mm a",
        }),
        createdAtTimestamp: parsedCreated.toDate().valueOf(),
        updatedAtTimestamp: parsedCreated.toDate().valueOf(),
        modifiedBy: revision.modified_by,
        modifiedById: revision.modified_by,
        commitMessage: revision.commit_message,
    }
}

const getRevisionNumber = (revision: EnhancedVariant | RevisionObject | ApiRevision): number => {
    const value =
        (revision as any).revision ??
        (revision as any).revisionNumber ??
        (revision as any).revision_label ??
        (revision as any).revisionLabel
    const parsed = Number(value)
    return Number.isNaN(parsed) ? 0 : parsed
}

const buildEnhancedRevisions = async (
    variant: Variant,
    projectId: string,
): Promise<EnhancedVariant[]> => {
    const parent = toParentVariant(variant)
    const revisions = await fetchRevisions(variant.variantId, projectId)

    if (!Array.isArray(revisions) || revisions.length === 0) {
        const fallback: RevisionObject = {
            id: variant.id || variant.variantId,
            revision: variant.revision,
            config: {
                config_name: variant.configName,
                parameters: variant.parameters,
            },
            createdAt: variant.createdAt,
            createdAtTimestamp: variant.createdAtTimestamp,
            updatedAtTimestamp: variant.updatedAtTimestamp,
            modifiedBy: variant.modifiedBy,
            modifiedById: undefined,
            commitMessage: variant.commitMessage,
        }
        const enhanced = adaptRevisionToVariant(fallback, parent)
        enhanced.uri = variant.uri
        enhanced.appId = variant.appId
        enhanced.baseId = variant.baseId
        enhanced.baseName = variant.baseName
        enhanced.configName = variant.configName
        enhanced.variantName = variant.variantName
        enhanced.commitMessage = variant.commitMessage
        enhanced.createdAt = variant.createdAt
        enhanced.updatedAt = variant.updatedAt
        enhanced.createdAtTimestamp = variant.createdAtTimestamp
        enhanced.updatedAtTimestamp = variant.updatedAtTimestamp
        return getRevisionNumber(enhanced) > 0 ? [enhanced] : []
    }

    return revisions
        .map((revision) => {
            const revisionObject = toRevisionObject(revision)
            const enhanced = adaptRevisionToVariant(revisionObject, parent)
            // Ensure core metadata is preserved
            enhanced.uri = variant.uri
            enhanced.appId = variant.appId
            enhanced.baseId = variant.baseId
            enhanced.baseName = variant.baseName
            enhanced.configName = variant.configName
            enhanced.variantName = variant.variantName
            enhanced.commitMessage = revision.commit_message ?? enhanced.commitMessage
            enhanced.createdAt = revisionObject.createdAt
            enhanced.createdAtTimestamp =
                revisionObject.createdAtTimestamp ?? variant.createdAtTimestamp
            enhanced.updatedAtTimestamp =
                revisionObject.updatedAtTimestamp ?? variant.updatedAtTimestamp
            return getRevisionNumber(enhanced) > 0 ? enhanced : null
        })
        .filter((rev): rev is EnhancedVariant => Boolean(rev))
}

export const useAppVariantRevisions = (appId?: string | null) => {
    const projectId = useAtomValue(projectIdAtom)

    const query = useQuery({
        queryKey: ["appVariantRevisions", projectId, appId],
        staleTime: 15_000,
        enabled: Boolean(appId && projectId),
        queryFn: async () => {
            if (!appId || !projectId) return [] as EnhancedVariant[]
            const variants = await fetchVariants(appId, false)
            if (!variants.length) return []

            const enhancedLists = await Promise.all(
                variants.map((variant) => buildEnhancedRevisions(variant, projectId)),
            )

            return enhancedLists
                .flat()
                .sort((a, b) => (b.updatedAtTimestamp ?? 0) - (a.updatedAtTimestamp ?? 0))
        },
    })

    const revisionMap = useMemo(() => {
        const data = query.data ?? []
        return data.reduce<Record<string, EnhancedVariant[]>>((acc, revision) => {
            const key = revision.variantId
            if (!acc[key]) {
                acc[key] = []
            }
            acc[key].push(revision)
            return acc
        }, {})
    }, [query.data])

    const variants = query.data ?? []
    const isInitialLoading = query.isLoading || (!variants.length && (query.isFetching ?? false))

    return {
        variants,
        revisionMap,
        isLoading: isInitialLoading,
        refetch: query.refetch,
    }
}

export default useAppVariantRevisions
