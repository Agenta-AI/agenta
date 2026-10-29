import {
    acceptHeader,
    agentInvokeBody,
    agentInvokeUrl,
    type AgentInvokeSnippetInput,
} from "./request"

export default function agentTypescriptCode(input: AgentInvokeSnippetInput): string {
    const payload = JSON.stringify(agentInvokeBody(input.agentId), null, 4)
    const head = `const url = "${agentInvokeUrl(input)}"
const headers = {
    Authorization: "ApiKey ${input.apiKey}",
    "Content-Type": "application/json",
    Accept: "${acceptHeader(input.stream)}",
}
const payload = ${payload}

const response = await fetch(url, {method: "POST", headers, body: JSON.stringify(payload)})
if (!response.ok) throw new Error(\`HTTP \${response.status}\`)
`
    if (input.stream) {
        return `${head}
const reader = response.body!.getReader()
const decoder = new TextDecoder()
let buffer = ""
while (true) {
    const {done, value} = await reader.read()
    if (done) break
    buffer += decoder.decode(value, {stream: true})
    const lines = buffer.split("\\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
        if (line.startsWith("data:")) console.log(JSON.parse(line.slice("data:".length)))
    }
}
`
    }
    return `${head}
console.log(JSON.stringify(await response.json(), null, 4))
`
}
