import {getEnv} from "@/oss/lib/helpers/dynamicEnv"

export const buildCurlSnippet = (
    appSlug: string,
    variantSlug: string,
    variantVersion: number,
    apiKey: string,
) => {
    return `curl -X POST "${getEnv("NEXT_PUBLIC_AGENTA_API_URL")}/variants/configs/fetch" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: ApiKey ${apiKey}" \\
  -d '{
    "variant_ref": {
      "slug": "${variantSlug}",
      "version": ${variantVersion}
    },
    "application_ref": {
      "slug": "${appSlug}"
    }
  }'
`
}
