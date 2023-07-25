export default function cURLCode(uri: string, params: string): string {
    return `curl -X POST ${uri} \
-H "Content-Type: application/json" \
-d '${params}'
`
}
