import {getEnv} from "@/oss/lib/helpers/dynamicEnv"

export default function cURLCode(appName: string, env_name: string, apiKey: string): string {
    return `curl -L '${getEnv("NEXT_PUBLIC_AGENTA_API_URL")}/variants/configs/fetch' \\
-H 'Content-Type: application/json' \\
-H "Authorization: ApiKey ${apiKey}" \\
-d '{
    "environment_ref": {
        "slug": "${env_name}"
    },
    "application_ref": {
        "slug": "${appName}"
    }
}'
`
}
