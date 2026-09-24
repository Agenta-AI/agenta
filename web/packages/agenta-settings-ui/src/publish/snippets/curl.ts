import {
    acceptHeader,
    agentInvokeBody,
    agentInvokeUrl,
    type AgentInvokeSnippetInput,
} from "./request"

export default function agentCurlCode(input: AgentInvokeSnippetInput): string {
    const body = JSON.stringify(agentInvokeBody(input.agentId), null, 2)
    return `curl ${input.stream ? "-N " : ""}-X POST "${agentInvokeUrl(input)}" \\
  -H "Authorization: ApiKey ${input.apiKey}" \\
  -H "Content-Type: application/json" \\
  -H "Accept: ${acceptHeader(input.stream)}" \\
  -d '${body}'
`
}
