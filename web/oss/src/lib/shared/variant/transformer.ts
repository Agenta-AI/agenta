import {dereference} from "@scalar/openapi-parser"

import {getJWT} from "@/oss/services/api"
import {getProjectValues} from "@/oss/state/project"

import {uriFixer} from "./utils"

/**
 * Fetches OpenAPI specification for a given variant from a service
 * @param variant - Variant object containing at least the variantId
 * @returns Promise containing variantId, parsed schema and any errors
 */
export const fetchOpenApiSchemaJson = async (uri: string) => {
    const jwt = await getJWT()
    try {
        const ts = Date.now()
        const base = `${uriFixer(uri)}/openapi.json${jwt ? `?project_id=${getProjectValues().projectId}` : ""}`
        const url = `${base}${base.includes("?") ? "&" : "?"}_ts=${ts}`
        const openapiJsonResponse = await fetch(url, {
            // Prevent the browser or proxies from caching this request
            cache: "no-store",
            headers: {
                "ngrok-skip-browser-warning": "1",
                "Cache-Control": "no-cache, no-store, must-revalidate",
                Pragma: "no-cache",
                Expires: "0",
                ...(jwt
                    ? {
                          Authorization: `Bearer ${jwt}`,
                      }
                    : {}),
            },
        })
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
        // Guard against pathological recursion (protocol-only like "http:" or empty)
        if (!newPath || newPath.endsWith(":") || newPath === "http:" || newPath === "https:") {
            return undefined
        }
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
        // Normalize relative URIs to absolute using window origin when available
        let normalizedUri = uri
        if (typeof normalizedUri === "string" && normalizedUri.startsWith("/")) {
            const origin = (globalThis as any)?.location?.origin
            if (origin) normalizedUri = `${origin}${normalizedUri}`
        }
        // Trim trailing slashes to avoid '//openapi.json'
        normalizedUri = normalizedUri.replace(/\/+$/, "")
        // Strip trailing openapi.json if provided as base
        if (normalizedUri.endsWith("/openapi.json")) {
            normalizedUri = normalizedUri.replace(/\/openapi\.json$/, "")
        }
        if (!normalizedUri || typeof normalizedUri !== "string") {
            return undefined
        }
        // Guard: avoid fetching protocol-only strings like "http:" which produce http://openapi.json
        if (!normalizedUri.includes("//")) {
            return undefined
        }

        const endpointPath = normalizedUri.endsWith("/openapi.json") ? "" : endpoint
        const url = `${normalizedUri}${endpointPath}${jwt ? `?project_id=${getProjectValues().projectId}` : ""}`
        let openapiJsonResponse: Response | undefined
        try {
            openapiJsonResponse = await fetch(url, {
                headers: {
                    "ngrok-skip-browser-warning": "1",
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                    Pragma: "no-cache",
                    Expires: "0",
                    ...(jwt
                        ? {
                              Authorization: `Bearer ${jwt}`,
                          }
                        : {}),
                },
                cache: "no-store",
                signal,
            })
        } catch {
            openapiJsonResponse = undefined
        }

        const data = await openapiJsonResponse?.json()
        if (!data || !openapiJsonResponse?.ok) {
            return await handleIncorrectUri(normalizedUri)
        } else {
            return {
                routePath: removedPaths || "",
                runtimePrefix: normalizedUri,
                status: openapiJsonResponse?.ok,
            }
        }
    } catch (err) {
        if (typeof uri === "string") {
            // If relative without leading slash, attempt origin + '/' + uri
            if (!uri.includes("//") && !uri.startsWith("/")) {
                const origin = (globalThis as any)?.location?.origin
                if (origin) return await handleIncorrectUri(`${origin}/${uri}`)
                return undefined
            }
            if (!uri.includes("//")) {
                const origin = (globalThis as any)?.location?.origin
                if (origin) return await handleIncorrectUri(`${origin}${uri}`)
                return undefined
            }
        }
        return await handleIncorrectUri(uri)
    }
}
