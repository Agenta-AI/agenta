export const buildPythonSnippet = (
    appSlug: string,
    variantSlug: string,
    variantVersion: number,
) => {
    return `# Fetch configuration by variant
import agenta as ag

config = ag.ConfigManager.get_from_registry(
    app_slug="${appSlug}",
    variant_slug="${variantSlug}",
    variant_version=${variantVersion}  # Optional: If not provided, fetches the latest version
)

print("Fetched configuration:")
print(config)
`
}
