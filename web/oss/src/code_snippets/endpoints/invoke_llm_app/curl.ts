export default function cURLCode(uri: string, params: string): string {
    return `curl -X POST ${uri} \\
-H "Content-Type: application/json" \\
-H "Authorization: ApiKey x.xxxxxxxx" \\ # Add your API key here, when using cloud
-d '${params}'
`
}
