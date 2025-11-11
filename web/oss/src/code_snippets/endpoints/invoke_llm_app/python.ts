export default function pythonCode(uri: string, params: string): string {
    return `import requests
import json

url = "${uri}"
params = ${params}
headers = {
    "Content-Type": "application/json",    
    "Authorization": "ApiKey x.xxxxxxxx", # Add your API key here, when using cloud
}

response = requests.post(url, json=params, headers=headers)

data = response.json()

print(json.dumps(data, indent=4))
`
}
