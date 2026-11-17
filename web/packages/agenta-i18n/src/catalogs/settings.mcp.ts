import en from "../../locales/en/settings.mcp.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "settings.mcp",
    en,
    (language) => import(`../../locales/${language}/settings.mcp.json`),
)
