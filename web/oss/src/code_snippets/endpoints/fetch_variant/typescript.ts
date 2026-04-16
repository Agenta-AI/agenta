import {getEnv} from "@/oss/lib/helpers/dynamicEnv"

export const buildTypescriptSnippet = (
    appSlug: string,
    variantSlug: string,
    variantVersion: number,
    apiKey: string,
) => {
    return `const fetchResponse = await fetch('${getEnv("NEXT_PUBLIC_AGENTA_API_URL")}/applications/revisions/retrieve', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': 'ApiKey ${apiKey}',
    },
    body: JSON.stringify({
        application_ref: {
            slug: '${appSlug}',
        },
        application_variant_ref: {
            slug: '${variantSlug}',
        },
        application_revision_ref: {
            version: '${variantVersion}',
        },
    }),
});

const config = await fetchResponse.json();
console.log('Fetched configuration:');
console.log(config);
`
}
