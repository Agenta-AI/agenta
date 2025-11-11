import type {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import type {Variant} from "@/oss/lib/Types"

export const buildVariantFromRevision = (
    revision: EnhancedVariant,
    fallbackAppId?: string,
): Variant => {
    return {
        id: revision.variantId,
        name: revision.variantName,
        variantName: revision.variantName,
        templateVariantName: (revision as any)?.templateVariantName ?? null,
        persistent: true,
        previousVariantName: (revision as any)?.previousVariantName ?? null,
        variantId: revision.variantId,
        appId: revision.appId ?? fallbackAppId ?? "",
        appName: revision.appName ?? "",
        baseId: revision.baseId ?? "",
        baseName: revision.baseName ?? "",
        configName: revision.configName ?? "",
        uri: revision.uri ?? "",
        parameters: revision.parameters ?? {},
        modifiedBy: revision.modifiedBy ?? revision.createdBy ?? "",
        modifiedById: revision.modifiedById ?? "",
        createdAt: revision.createdAt ?? "",
        createdAtTimestamp: revision.createdAtTimestamp ?? 0,
        updatedAt: revision.updatedAt ?? revision.createdAt ?? "",
        updatedAtTimestamp: revision.updatedAtTimestamp ?? revision.createdAtTimestamp ?? 0,
        isLatestRevision: revision.isLatestRevision ?? false,
        commitMessage: revision.commitMessage ?? null,
        deployedIn: revision.deployedIn ?? [],
        projectId: (revision as any)?.projectId ?? "",
        revisions: [],
    } as Variant
}
