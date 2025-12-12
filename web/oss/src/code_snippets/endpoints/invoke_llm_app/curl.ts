export default function cURLCode(uri: string, params: string, apiKey: string): string {
    const parsedParams = JSON.parse(params)
    const isChat = parsedParams.messages !== undefined

    return `curl -X POST "${uri}" \\
-H "Content-Type: application/json" \\
-H "Authorization: ApiKey ${apiKey}" \\${isChat ? '\n-H "Baggage: ag.meta.session_id=your_session_id" \\' : ""}
-d '${params}'
`
}
