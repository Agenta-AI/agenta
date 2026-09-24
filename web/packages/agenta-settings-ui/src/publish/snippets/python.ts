import {
    acceptHeader,
    agentInvokeBody,
    agentInvokeUrl,
    type AgentInvokeSnippetInput,
} from "./request"

export default function agentPythonCode(input: AgentInvokeSnippetInput): string {
    const payload = JSON.stringify(agentInvokeBody(input.agentId), null, 4)
    const head = `import json

import requests

url = "${agentInvokeUrl(input)}"
headers = {
    "Authorization": "ApiKey ${input.apiKey}",
    "Content-Type": "application/json",
    "Accept": "${acceptHeader(input.stream)}",
}
payload = ${payload}
`
    if (input.stream) {
        return `${head}
with requests.post(url, json=payload, headers=headers, stream=True) as response:
    response.raise_for_status()
    for line in response.iter_lines(decode_unicode=True):
        if line.startswith("data:"):
            print(json.loads(line[len("data:"):]))
`
    }
    return `${head}
response = requests.post(url, json=payload, headers=headers)
response.raise_for_status()

print(json.dumps(response.json(), indent=4))
`
}
