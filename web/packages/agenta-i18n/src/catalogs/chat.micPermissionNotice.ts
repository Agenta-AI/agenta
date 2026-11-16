import en from "../../locales/en/chat.micPermissionNotice.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "chat.micPermissionNotice",
    en,
    (language) => import(`../../locales/${language}/chat.micPermissionNotice.json`),
)
