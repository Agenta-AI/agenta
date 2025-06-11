export default function cURLCode(uri: string, params: string): string {
    return `# Add your API key
curl -X POST ${uri} \\
-H "Content-Type: application/json" \\
-H "Authorization: ApiKey x.xxxxxxxx" \\
-d '${params}'
`
}
