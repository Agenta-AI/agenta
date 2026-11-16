import en from "../../locales/en/chat.attachmentCard.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "chat.attachmentCard",
    en,
    (language) => import(`../../locales/${language}/chat.attachmentCard.json`),
)
