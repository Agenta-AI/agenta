export default function pythonCode(uri: string, params: string): string {
    return `import requests
import json

url = "${uri}"
params = ${params}

response = requests.post(url, json=params)

data = response.json()

print(json.dumps(data, indent=4))
`
}
