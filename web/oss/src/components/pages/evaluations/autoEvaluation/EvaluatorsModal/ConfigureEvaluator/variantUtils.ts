import type {Workflow} from "@agenta/entities/workflow"

import type {Variant} from "@/oss/lib/Types"

const toUnixMs = (value: string | null | undefined): number => {
    if (!value) return 0
    const ts = new Date(value).getTime()
    return Number.isFinite(ts) ? ts : 0
}

export const buildVariantFromRevision = (revision: Workflow, fallbackAppId?: string): Variant => {
    return {
        id: revision.workflow_variant_id ?? revision.id,
        name: revision.name ?? "",
        variantName: revision.name ?? "",
        templateVariantName: null,
        persistent: true,
        previousVariantName: null,
        variantId: revision.workflow_variant_id ?? revision.id,
        appId: revision.workflow_id ?? fallbackAppId ?? "",
        appName: "",
        baseId: "",
        baseName: "",
        configName: "",
        uri: revision.data?.uri ?? "",
        parameters: revision.data?.parameters ?? {},
        modifiedBy: revision.updated_by_id ?? revision.created_by_id ?? "",
        modifiedById: revision.updated_by_id ?? "",
        createdAt: revision.created_at ?? "",
        createdAtTimestamp: toUnixMs(revision.created_at),
        updatedAt: revision.updated_at ?? revision.created_at ?? "",
        updatedAtTimestamp: toUnixMs(revision.updated_at) || toUnixMs(revision.created_at),
        isLatestRevision: false,
        commitMessage: revision.message ?? null,
        deployedIn: [],
        projectId: "",
        revisions: [],
    } as Variant
}
