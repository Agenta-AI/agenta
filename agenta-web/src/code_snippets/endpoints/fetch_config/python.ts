export default function pythonCode(appName: string, env_name: string): string {
    return `
    # os.environ["AGENTA_API_KEY"] = "your_api_key" # Only when using cloud
    # os.environ["AGENTA_HOST"] = "${process.env.NEXT_PUBLIC_AGENTA_API_URL}"

    import agenta as ag

    # ag.init() <- uncomment if you don't already have this
    config = ag.ConfigManager.get_from_registry(
        app_slug="${appName}",
        environment_slug="${env_name}" # choose production, staging, or development       
     )    

    print("Fetched configuration from staging:")
    print(config)
    `
}
