export default function cURLCode(appName: string, env_name: string): string {
    return `
    curl -X GET "${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/variants/configs/fetch?app_name=${appName}&environment_slug=${env_name}" \\
    -H "Authorization: Bearer YOUR_API_KEY" \\
    -H "Content-Type: application/json" \\
    --connect-timeout 60
    `
}
