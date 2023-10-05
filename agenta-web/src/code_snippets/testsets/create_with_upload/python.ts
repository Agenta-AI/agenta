export default function pythonCode(uri: string, appId: string): string {
    return `import requests

url = '${uri}'
file_path = '/path/to/your/file.csv'
testset_name = 'your_testset_name'
appId = '${appId}'

with open(file_path, 'rb') as file:
    files = {'file': file}
    data = {'testset_name': testset_name, 'app_id': appId}
    response = requests.post(url, files=files, data=data)

print(response.status_code)
print(response.json())
`
}
