import en from "../../locales/en/chat.chatTable.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "chat.chatTable",
    en,
    (language) => import(`../../locales/${language}/chat.chatTable.json`),
)
