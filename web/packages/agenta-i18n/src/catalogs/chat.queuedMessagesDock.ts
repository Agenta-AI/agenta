import en from "../../locales/en/chat.queuedMessagesDock.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "chat.queuedMessagesDock",
    en,
    (language) => import(`../../locales/${language}/chat.queuedMessagesDock.json`),
)
