export const buildPythonSnippet = (
    appSlug: string,
    variantSlug: string,
    variantVersion: number,
) => {
    return `import agenta as ag

config = ag.ConfigManager.get_from_registry(
    app_slug="${appSlug}",
    variant_slug="${variantSlug}",
    variant_version=${variantVersion},
)

print("Fetched configuration:")
print(config)
`
}
