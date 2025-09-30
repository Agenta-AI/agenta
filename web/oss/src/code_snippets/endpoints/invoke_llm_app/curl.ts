export default function cURLCode(uri: string, params: string, apiKey: string): string {
    return `curl -X POST "${uri}" \\
-H "Content-Type: application/json" \\
-H "Authorization: ApiKey ${apiKey}" \\
-d '${params}'
`
}
