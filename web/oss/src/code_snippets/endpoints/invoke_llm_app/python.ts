export default function pythonCode(uri: string, params: string, apiKey: string): string {
    const parsedParams = JSON.parse(params)
    const isChat = parsedParams.messages !== undefined

    return `import requests
import json

url = "${uri}"
params = ${params}
headers = {
    "Content-Type": "application/json",
    "Authorization": "ApiKey ${apiKey}",${isChat ? '\n    "Baggage": "ag.session.id=your_session_id",' : ""}
}

response = requests.post(url, json=params, headers=headers)

data = response.json()

print(json.dumps(data, indent=4))
`
}
