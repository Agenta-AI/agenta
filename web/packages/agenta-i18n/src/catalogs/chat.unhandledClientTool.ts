import en from "../../locales/en/chat.unhandledClientTool.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "chat.unhandledClientTool",
    en,
    (language) => import(`../../locales/${language}/chat.unhandledClientTool.json`),
)
