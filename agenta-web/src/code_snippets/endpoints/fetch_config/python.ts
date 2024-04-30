export default function pythonCode(uri: string, config_url: string, params: string): string {
    return `
import requests
import json

url = "${uri}"
config_url = "${config_url}"

config_response = requests.get(config_url)
config_data = config_response.json()

params = ${params}
params.update(config_data)

response = requests.post(url, json=params)

data = response.json()

print(json.dumps(data, indent=4))
`
}
