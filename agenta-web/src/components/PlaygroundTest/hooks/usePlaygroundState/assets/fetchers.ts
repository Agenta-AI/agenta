import {Variant} from "@/lib/Types"
import {dereference} from "@scalar/openapi-parser"
import {type OpenAPI} from "@scalar/openapi-types"

export const openAPIJsonFetcher = async (variant: Pick<Variant, "variantId">, service: string) => {
    const openapiJsonResponse = await fetch(`http://localhost/${service}/openapi.json`)
    const responseJson = await openapiJsonResponse.json()
    const doc = responseJson as OpenAPI.Document
    const {schema, errors} = await dereference(doc)

    return {
        variantId: variant.variantId,
        schema: schema,
        errors,
    }
}
