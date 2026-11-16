import en from "../../locales/en/chat.chatComposer.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "chat.chatComposer",
    en,
    (language) => import(`../../locales/${language}/chat.chatComposer.json`),
)
