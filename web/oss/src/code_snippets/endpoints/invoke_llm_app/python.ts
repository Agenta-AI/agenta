export default function pythonCode(uri: string, params: string, apiKey: string): string {
    const parsedParams = JSON.parse(params)
    const isChat = parsedParams.messages !== undefined

    return `import requests
import json

url = "${uri}"
params = ${params}
headers = {
    "Content-Type": "application/json",    
    "Authorization": "ApiKey ${apiKey}", # Add your API key here${isChat ? '\n    "Baggage": "ag.meta.session_id=your_session_id", # Optional: track chat sessions' : ""}
}

response = requests.post(url, json=params, headers=headers)

data = response.json()

print(json.dumps(data, indent=4))
`
}
