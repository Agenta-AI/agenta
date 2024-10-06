export default function cURLCode(baseId: string, env_name: string): string {
    return `
    curl -X GET "${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/configs?base_id=${baseId}&environment_name=${env_name}" \\
    -H "Authorization: Bearer YOUR_API_KEY" \\
    -H "Content-Type: application/json" \\
    --connect-timeout 60
    `
}
