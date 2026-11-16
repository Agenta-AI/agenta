import en from "../../locales/en/chat.runFailureCallout.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "chat.runFailureCallout",
    en,
    (language) => import(`../../locales/${language}/chat.runFailureCallout.json`),
)
