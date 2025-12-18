export default function cURLCode(uri: string, params: string, apiKey: string): string {
    const parsedParams = JSON.parse(params)
    const isChat = parsedParams.messages !== undefined

    return `# Add your API key to the Authorization header
curl -X POST "${uri}" \\
-H "Content-Type: application/json" \\
-H "Authorization: ApiKey ${apiKey}" \\${isChat ? '\n-H "Baggage: ag.session.id=your_session_id" \\ # Optional: track chat sessions' : ""}
-d '${params}'
`
}
