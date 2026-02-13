/**
 * Main transformation logic for converting OpenAPI schemas to enhanced variants
 *
 * This module provides thin wrappers around the entity package's derivation
 * functions, handling the OpenAPI spec → ag_config schema extraction step
 * that is specific to the OSS layer.
 *
 * The core derivation logic lives in:
 * @agenta/entities/legacyAppRevision → utils/specDerivation.ts
 */

import {
    deriveEnhancedPrompts,
    deriveEnhancedCustomProperties,
    type EntitySchema,
} from "@agenta/entities/legacyAppRevision"

import type {Enhanced, EnhancedObjectConfig} from "../genericTransformer/types"
import type {OpenAPISpec} from "../genericTransformer/types"
import {getRequestSchema} from "../openapiUtils"

import type {EnhancedVariant, AgentaConfigPrompt} from "./types"

/**
 * Extract the ag_config parameters from a variant in the format expected
 * by the entity derivation functions.
 */
function extractVariantParameters(variant: EnhancedVariant): Record<string, unknown> {
    const params = variant.parameters as Record<string, unknown> | undefined
    if (!params) return {}
    return (params as any).ag_config || (params as any).agConfig || params
}

/**
 * Derive prompt configs from OpenAPI spec + saved parameters without mutating input.
 *
 * Extracts the ag_config schema from the OpenAPI spec, then delegates to
 * the entity package's deriveEnhancedPrompts for the actual transformation.
 */
export function derivePromptsFromSpec(
    variant: EnhancedVariant,
    openApiSpec: OpenAPISpec,
    routePath?: string,
): EnhancedObjectConfig<AgentaConfigPrompt>[] {
    const requestSchema = getRequestSchema(openApiSpec, {variant, routePath})
    const agConfig = requestSchema?.properties?.ag_config as unknown as EntitySchema | undefined
    const parameters = extractVariantParameters(variant)

    return deriveEnhancedPrompts(
        agConfig ?? null,
        parameters,
    ) as unknown as EnhancedObjectConfig<AgentaConfigPrompt>[]
}

/**
 * Derive custom properties (non-prompt) from OpenAPI spec + saved parameters.
 *
 * Extracts the ag_config schema from the OpenAPI spec, then delegates to
 * the entity package's deriveEnhancedCustomProperties for the actual transformation.
 */
export function deriveCustomPropertiesFromSpec(
    variant: EnhancedVariant,
    openApiSpec: OpenAPISpec,
    routePath?: string,
): Record<string, Enhanced<any>> {
    const requestSchema = getRequestSchema(openApiSpec, {variant, routePath})
    const agConfig = requestSchema?.properties?.ag_config as unknown as EntitySchema | undefined
    const parameters = extractVariantParameters(variant)

    return deriveEnhancedCustomProperties(agConfig ?? null, parameters) as Record<
        string,
        Enhanced<any>
    >
}
