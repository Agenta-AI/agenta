import en from "../../locales/en/chat.composerRejections.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "chat.composerRejections",
    en,
    (language) => import(`../../locales/${language}/chat.composerRejections.json`),
)
