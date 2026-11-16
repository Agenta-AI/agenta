import en from "../../locales/en/chat.mcpServerNotice.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "chat.mcpServerNotice",
    en,
    (language) => import(`../../locales/${language}/chat.mcpServerNotice.json`),
)
