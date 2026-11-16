import en from "../../locales/en/chat.approvalCard.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "chat.approvalCard",
    en,
    (language) => import(`../../locales/${language}/chat.approvalCard.json`),
)
