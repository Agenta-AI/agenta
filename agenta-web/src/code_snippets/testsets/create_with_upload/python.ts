import {isDemo} from "@/lib/helpers/utils"

export default function pythonCode(uri: string): string {
    return `import requests

url = '${uri}'
file_path = '/path/to/your/file.csv'
testset_name = 'your_testset_name'

with open(file_path, 'rb') as file:
    files = {'file': file}
    data = {'testset_name': testset_name}
    response = requests.post(url, files=files, data=data${
        !isDemo() ? "" : ", headers={'Authorization': 'your_api_key'}"
    })

print(response.status_code)
print(response.json())
`
}
