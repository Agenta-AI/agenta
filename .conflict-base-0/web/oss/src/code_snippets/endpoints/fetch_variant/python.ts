import {getEnv} from "@/oss/lib/helpers/dynamicEnv"

export const buildPythonSnippet = (
    appSlug: string,
    variantSlug: string,
    variantVersion: number,
    apiKey: string,
) => {
    return `import os
import agenta as ag

os.environ["AGENTA_API_KEY"] = ${JSON.stringify(apiKey)}
os.environ["AGENTA_API_URL"] = ${JSON.stringify(getEnv("NEXT_PUBLIC_AGENTA_API_URL") ?? "")}

config = ag.ConfigManager.get_from_registry(
    app_slug="${appSlug}",
    variant_slug="${variantSlug}",
    variant_version=${variantVersion},
)

print("Fetched configuration:")
print(config)
`
}
