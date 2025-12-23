export const buildTypescriptSnippet = (
    appSlug: string,
    variantSlug: string,
    variantVersion: number,
    apiKey: string,
) => {
    return `// Fetch configuration by variant
    const fetchResponse = await fetch('https://cloud.agenta.ai/api/variants/configs/fetch', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ${apiKey}'
    },
    body: JSON.stringify({
        variant_ref: {
        slug: '${variantSlug}',
        version: ${variantVersion},
        id: null
        },
        application_ref: {
        slug: '${appSlug}',
        version: null,
        id: null
        }
    })
    });

    const config = await fetchResponse.json();
    console.log('Fetched configuration:');
    console.log(config);
    `
}
