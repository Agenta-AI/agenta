export default function cURLCode(baseId: string, env_name: string): string {
    return `
    curl -X GET "https://cloud.agenta.ai/api/configs?base_id=${baseId}&environment_name=${env_name}" \\
    -H "Authorization: Bearer YOUR_API_KEY" \\
    -H "Content-Type: application/json" \\
    --connect-timeout 60
    `
}
