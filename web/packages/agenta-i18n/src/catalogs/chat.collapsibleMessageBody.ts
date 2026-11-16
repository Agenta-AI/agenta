import en from "../../locales/en/chat.collapsibleMessageBody.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "chat.collapsibleMessageBody",
    en,
    (language) => import(`../../locales/${language}/chat.collapsibleMessageBody.json`),
)
