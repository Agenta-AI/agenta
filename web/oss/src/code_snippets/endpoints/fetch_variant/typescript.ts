import {getEnv} from "@/oss/lib/helpers/dynamicEnv"

export const buildTypescriptSnippet = (
    appSlug: string,
    variantSlug: string,
    variantVersion: number,
    apiKey: string,
) => {
    return `const fetchResponse = await fetch('${getEnv("NEXT_PUBLIC_AGENTA_API_URL")}/variants/configs/fetch', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': 'ApiKey ${apiKey}',
    },
    body: JSON.stringify({
        variant_ref: {
            slug: '${variantSlug}',
            version: ${variantVersion},
        },
        application_ref: {
            slug: '${appSlug}',
        },
    }),
});

const config = await fetchResponse.json();
console.log('Fetched configuration:');
console.log(config);
`
}
