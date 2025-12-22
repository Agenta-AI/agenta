export const buildCurlSnippet = (
    appSlug: string,
    variantSlug: string,
    variantVersion: number,
    apiKey: string,
) => {
    return `# Fetch configuration by variant
curl -X POST "https://cloud.agenta.ai/api/variants/configs/fetch" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${apiKey}" \\
  -d '{
    "variant_ref": {
      "slug": "${variantSlug}",
      "version": ${variantVersion},
      "id": null
    },
    "application_ref": {
      "slug": "${appSlug}",
      "version": null,
      "id": null
    }
  }'
`
}
