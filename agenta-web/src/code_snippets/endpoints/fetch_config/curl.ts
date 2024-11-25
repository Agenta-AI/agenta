export default function cURLCode(appName: string, env_name: string): string {
    return `curl -L '${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/variants/configs/fetch' \\
-H 'Content-Type: application/json' \\
-H "Authorization: ApiKey x.xxxxxxxx" \\ # Add your API key here, when using cloud
-d '{
    "environment_ref": {
        "slug": "${env_name}",
        "version": null,
        "id": null
    },
    "application_ref": {
        "slug": "${appName}",
        "version": null,
        "id": null
    }
}'
`
}
