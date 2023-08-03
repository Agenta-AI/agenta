export default function pythonCode(uri: string, params: string): string {
    return `import requests
import json

url = '${uri}'
data = {
    "name": "your_testset_name",
    "csvdata": [
        {"column1": "value1", "column2": "value2"},
        {"column1": "value3", "column2": "value4"}
    ]
}

response = requests.post(url, data=json.dumps(data), headers={'Content-Type': 'application/json'})

print(response.status_code)
print(response.json())
`
}
