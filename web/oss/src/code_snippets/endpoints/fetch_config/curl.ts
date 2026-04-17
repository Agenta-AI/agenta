import {getEnv} from "@/oss/lib/helpers/dynamicEnv"

export default function cURLCode(appName: string, env_name: string, apiKey: string): string {
    return `curl -X POST '${getEnv("NEXT_PUBLIC_AGENTA_API_URL")}/applications/revisions/retrieve' \\
-H 'Content-Type: application/json' \\
-H "Authorization: ApiKey ${apiKey}" \\
-d '{
    "application_ref": {
        "slug": "${appName}"
    },
    "environment_ref": {
        "slug": "${env_name}"
    }
}'
`
}
