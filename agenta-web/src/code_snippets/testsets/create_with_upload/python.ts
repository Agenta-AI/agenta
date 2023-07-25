export default function pythonCode(uri: string, appName: string): string {
    return `import requests

url = '${uri}'
file_path = '/path/to/your/file.csv'
dataset_name = 'your_dataset_name'
appName = '${appName}'

with open(file_path, 'rb') as file:
    files = {'file': file}
    data = {'dataset_name': dataset_name, 'app_name': appName}
    response = requests.post(url, files=files, data=data)

print(response.status_code)
print(response.json())
`
}
