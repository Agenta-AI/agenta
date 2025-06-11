import {getEnv} from "@/oss/lib/helpers/dynamicEnv"

export default function pythonCode(appName: string, env_name: string): string {
    return `
import os
import agenta as ag

os.environ["AGENTA_API_KEY"] = "x.xxxxxxxx" # Add your API key here
os.environ["AGENTA_HOST"] = "${getEnv("NEXT_PUBLIC_AGENTA_API_URL")}"

ag.init()
config = ag.ConfigManager.get_from_registry(
    app_slug="${appName}",
    environment_slug="${env_name}"       
 )
print(config)
`
}
