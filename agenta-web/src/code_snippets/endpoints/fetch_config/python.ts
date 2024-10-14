export default function pythonCode(baseId: string, env_name: string): string {
    return `
    # os.environ["AGENTA_API_KEY"] = "your_api_key" # Only when using cloud
    # os.environ["AGENTA_HOST"] = "${process.env.NEXT_PUBLIC_AGENTA_API_URL}"

    from agenta import Agenta
    ag = Agenta()
    ag.get_config(base_id="${baseId}",
                  environment="${env_name}",
                  cache_timeout=600) # timeout 300 per default
    `
}
