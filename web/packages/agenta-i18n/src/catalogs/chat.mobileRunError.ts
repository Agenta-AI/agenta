import en from "../../locales/en/chat.mobileRunError.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "chat.mobileRunError",
    en,
    (language) => import(`../../locales/${language}/chat.mobileRunError.json`),
)
