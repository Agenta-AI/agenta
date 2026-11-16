import en from "../../locales/en/chat.connectionDock.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "chat.connectionDock",
    en,
    (language) => import(`../../locales/${language}/chat.connectionDock.json`),
)
