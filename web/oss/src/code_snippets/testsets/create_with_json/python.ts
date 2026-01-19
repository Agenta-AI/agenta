import {isDemo} from "@/oss/lib/helpers/utils"

export default function pythonCode(uri: string, params: string): string {
    return `import requests
import json

url = '${uri}'

data = {
    "testset": {
        "slug": "your-testset-slug",
        "name": "your_testset_name",
        "data": {
            "testcases": [
                {"data": {"column1": "value1", "column2": "value2"}},
                {"data": {"column1": "value3", "column2": "value4"}},
            ]
        },
    }
}

headers = {'Content-Type': 'application/json'${!isDemo() ? "" : ", 'Authorization': 'your_api_key'"}}

response = requests.post(url, data=json.dumps(data), headers=headers)

print(response.status_code)
print(response.json())
`
}
