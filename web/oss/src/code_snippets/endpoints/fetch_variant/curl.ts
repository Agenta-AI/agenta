import {getEnv} from "@/oss/lib/helpers/dynamicEnv"

export const buildCurlSnippet = (
    appSlug: string,
    variantSlug: string,
    variantVersion: number,
    apiKey: string,
) => {
    return `curl -X POST "${getEnv("NEXT_PUBLIC_AGENTA_API_URL")}/preview/applications/revisions/retrieve" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: ApiKey ${apiKey}" \\
  -d '{
    "application_ref": {
      "slug": "${appSlug}"
    },
    "application_variant_ref": {
      "slug": "${variantSlug}"
    },
    "application_revision_ref": {
      "version": "${variantVersion}"
    }
  }'
`
}
