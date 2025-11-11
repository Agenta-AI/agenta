import {dereference} from "@scalar/openapi-parser"

import {getCurrentProject} from "@/oss/contexts/project.context"
import {getJWT} from "@/oss/services/api"

import {initializeVariantInputs, updateVariantPromptKeys} from "./inputHelpers"
import {transformToEnhancedVariant} from "./transformer/transformer"
import {EnhancedVariant} from "./transformer/types"
import {OpenAPISpec} from "./types/openapi"
import {uriFixer} from "./utils"

/**
 * Fetches OpenAPI specification for a given variant from a service
 * @param variant - Variant object containing at least the variantId
 * @returns Promise containing variantId, parsed schema and any errors
 */
export const fetchOpenApiSchemaJson = async (uri: string) => {
    const jwt = await getJWT()
    try {
        const openapiJsonResponse = await fetch(
            `${uriFixer(uri)}/openapi.json${jwt ? `?project_id=${getCurrentProject().projectId}` : ""}`,
            {
                headers: {
                    "ngrok-skip-browser-warning": "1",
                    ...(jwt
                        ? {
                              Authorization: `Bearer ${jwt}`,
                          }
                        : {}),
                },
            },
        )
        if (openapiJsonResponse.ok) {
            const responseJson = await openapiJsonResponse.json()
            const {schema, errors} = await dereference(responseJson)

            return {
                schema: schema,
                errors,
            }
        } else {
            return {
                schema: undefined,
                errors: (await openapiJsonResponse.json()) || openapiJsonResponse.statusText,
            }
        }
    } catch (err) {
        console.error(err)
        return {
            schema: undefined,
            errors: ["Failed to fetch OpenAPI schema"],
        }
    }
}

export const findCustomWorkflowPath = async (
    uri: string,
    endpoint = "/openapi.json",
    removedPaths?: string,
    signal?: AbortSignal,
): Promise<
    | {
          routePath: string
          runtimePrefix: string
          status?: boolean
      }
    | undefined
> => {
    const jwt = await getJWT()

    const handleIncorrectUri = async (incorrectUri: string) => {
        const paths = incorrectUri.split("/")
        const removedPath = paths.pop()

        const newPath = paths.join("/")
        return newPath
            ? await findCustomWorkflowPath(
                  newPath,
                  endpoint,
                  `${removedPath}${removedPaths ? `/${removedPaths}` : ""}`,
              )
            : {
                  routePath: removedPaths || "",
                  runtimePrefix: uri,
              }
    }

    try {
        if (!uri || !uri.includes("//")) {
            throw new Error("No uri found")
        }

        const openapiJsonResponse = await fetch(
            `${uri}${endpoint}${jwt ? `?project_id=${getCurrentProject().projectId}` : ""}`,
            {
                headers: {
                    "ngrok-skip-browser-warning": "1",
                    ...(jwt
                        ? {
                              Authorization: `Bearer ${jwt}`,
                          }
                        : {}),
                },
                signal,
            },
        )

        const data = await openapiJsonResponse.json()
        if (!data || !openapiJsonResponse.ok) {
            return await handleIncorrectUri(uri)
        } else {
            return {
                routePath: removedPaths || "",
                runtimePrefix: uri,
                status: openapiJsonResponse.ok,
            }
        }
    } catch (err) {
        if (!uri.includes("//")) {
            return undefined
        } else {
            return await handleIncorrectUri(uri)
        }
    }
}

/**
 * Transform a single variant using OpenAPI schema
 */
export const transformVariant = (
    variant: EnhancedVariant,
    schema: OpenAPISpec,
    appType?: string,
) => {
    try {
        const enhancedVariant = transformToEnhancedVariant(variant, schema, appType)
        // Update prompt keys and initialize inputs
        // @ts-ignore
        updateVariantPromptKeys(enhancedVariant)
        // @ts-ignore
        initializeVariantInputs(enhancedVariant, schema)
        return enhancedVariant
    } catch (err) {
        console.error("Error transforming variant:", err)
        throw err
    }
}

/**
 * Transform multiple variants using OpenAPI schema
 */
export const transformVariants = (
    variants: EnhancedVariant[],
    schema: OpenAPISpec,
    appType?: string,
): EnhancedVariant[] => {
    try {
        // @ts-ignore
        return (variants || []).map((variant) => transformVariant(variant, schema, appType))
    } catch (error) {
        console.error("Error transforming variants:", error)
        throw error
    }
}
