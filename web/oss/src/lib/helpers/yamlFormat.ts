import yaml from "js-yaml"

import {getStringOrJson} from "./utils"

/**
 * Serialize data as YAML (or pretty JSON), falling back to JSON on YAML errors.
 *
 * Kept out of `utils.ts` so the widely-imported helper barrel does not pull
 * `js-yaml` (~37 kB) into the shared `_app` chunk — only the few editors/drawers
 * that actually format YAML load it.
 */
export const getYamlOrJson = (format: "JSON" | "YAML", data: any) => {
    try {
        return format === "YAML" ? yaml.dump(data) : getStringOrJson(data)
    } catch (error) {
        return getStringOrJson(data)
    }
}
