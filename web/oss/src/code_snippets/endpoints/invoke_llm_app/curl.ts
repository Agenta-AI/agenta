export default function cURLCode(uri: string, params: string): string {
    return `# Add your API key when using cloud
curl -X POST ${uri} \\
-H "Content-Type: application/json" \\
-H "Authorization: ApiKey x.xxxxxxxx" \\
-d '${params}'
`
}
