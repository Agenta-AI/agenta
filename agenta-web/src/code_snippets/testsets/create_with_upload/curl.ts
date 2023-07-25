export default function cURLCode(uri: string, appName: string): string {
    return `curl -X POST ${uri} \\
-H 'Content-Type: multipart/form-data' \\
-F 'file=@/path/to/your/file.csv' \\
-F 'dataset_name=your_dataset_name' \\
-F 'app_name=${appName}'
`
}
