import en from "../../locales/en/chat.slashCommands.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "chat.slashCommands",
    en,
    (language) => import(`../../locales/${language}/chat.slashCommands.json`),
)
