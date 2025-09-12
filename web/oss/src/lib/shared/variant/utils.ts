// @ts-nocheck

import {CamelCaseEnvironment} from "../../Types"

import {Enhanced} from "./genericTransformer/types"
import {EnhancedVariant} from "./transformer/types/transformedVariant"
import {RevisionObject, ParentVariantObject} from "./transformer/types/variant"

/**
 * Remove trailing slash from a URI
 */
export const removeTrailingSlash = (uri: string) => {
    return uri.endsWith("/") ? uri.slice(0, -1) : uri
}

export const uriFixer = (uri: string) => {
    if (!uri.includes("http://") && !uri.includes("https://")) {
        // for oss.agenta.ai
        uri = `https://${uri}`
    } else if (!uri.includes("/services/")) {
        uri = uri.replace("/chat", "/services/chat")
        uri = uri.replace("/completion", "/services/completion")
    }

    // Remove trailing slash if it exists
    return removeTrailingSlash(uri)
}

/**
 * Finds all environments where a specific revision is deployed
 */
export const findRevisionDeployment = (
    revisionId: string,
    environments: CamelCaseEnvironment[],
): CamelCaseEnvironment[] => {
    return environments.filter((env) => {
        return env.deployedAppVariantRevisionId === revisionId
    })
}

/** Enhanced property utilities */
export const getEnhancedProperties = (obj: Record<string, any> | undefined, exclude?: string[]) => {
    if (!obj) return []
    return Object.entries(obj)
        .filter(([key]) => !exclude?.includes(key))
        .reduce((acc, [_, value]) => {
            if (value && typeof value === "object" && "__id" in value) {
                acc.push(value)
            }
            return acc
        }, [] as Enhanced<unknown>[])
}

/**
 * Adapts a revision to appear as a variant for UI/API compatibility
 *
 * IMPORTANT: This function creates a base adapter revision that can be passed to
 * transformVariants later for proper schema-based transformation. It prioritizes
 * revision-specific configuration values over parent variant values.
 *
 * @param revision The revision object to adapt
 * @param parentVariant The parent variant that contains this revision
 * @returns An EnhancedVariant-like object that combines revision and parent variant data
 */
export const adaptRevisionToVariant = (
    revision: RevisionObject,
    parentVariant: ParentVariantObject,
): EnhancedVariant => {
    // Validate input objects
    // validateVariantObject(revision, ["id", "_id"], "revision")
    // validateVariantObject(parentVariant, ["id", "variantId"], "parent variant")

    // Ensure we have a valid parent variant ID
    const parentId = parentVariant.id || parentVariant.variantId

    // Ensure revision ID exists
    const revisionId = revision.id || revision._id

    // Do not mutate parentVariant; compute any derived fields locally

    return {
        // Minimal identifiers
        id: revisionId,
        variantId: parentId,

        // Strictly revision-derived fields
        _revisionId: revisionId,
        revision: revision.revision,
        parameters: revision.parameters || revision.config?.parameters,
        customProperties: revision.customProperties,
        createdAt: revision.createdAt || revision.created_at,
        updatedAt: revision.updatedAt || revision.createdAt,
        createdAtTimestamp: revision.createdAtTimestamp,
        updatedAtTimestamp: revision.updatedAtTimestamp || revision.createdAtTimestamp,
        modifiedById: revision.modifiedById,
        modifiedBy: revision.modifiedBy ?? revision.modified_by ?? null,
        commitMessage: (revision as any).commitMessage ?? (revision as any).commit_message ?? null,
        variantName: parentVariant.variantName,
        // Inherit parent-variant level identifiers required by downstream APIs/UI
        baseId: (parentVariant as any).baseId,
        baseName: (parentVariant as any).baseName,
        configName: (parentVariant as any).configName,
        // Parent reference by ID only; consumers must use selector-family atoms
        _parentVariant: parentId,
    }
}

// TODO: DEPRECATE @ardaerzin
export const setVariant = (variant: any, uri): EnhancedVariant => {
    // TEMPORARY FIX FOR PREVIOUSLY CREATED AGENTA_CONFIG
    // TODO: REMOVE THIS BEFORE RELEASE.
    if (variant.parameters?.agenta_config) {
        variant.parameters = variant.parameters.agenta_config
        delete variant.parameters.agenta_config
    }

    // Source priority: variant.parameters, variant.config?.parameters
    const rawParameters = variant.parameters ?? variant.config?.parameters ?? {}
    const parameters = rawParameters.ag_config ?? rawParameters.agConfig ?? rawParameters

    if (variant.variantId) {
        variant.id = variant.variantId
        variant.parameters = parameters ?? {}

        return variant
    }

    return {
        id: variant.variant_id,
        uri: uri || uriFixer(variant.uri),
        appId: variant.app_id,
        baseId: variant.base_id,
        baseName: variant.base_name,
        variantName: variant.variant_name,
        templateVariantName: variant.template_variant_name,
        revision: variant.revision,
        configName: variant.config_name,
        projectId: variant.project_id,
        appName: variant.app_name,
        parameters: {
            ...parameters,
        },
        isChat: false,
        name: "",
        updatedAt: variant.updated_at,
    } as EnhancedVariant
}
