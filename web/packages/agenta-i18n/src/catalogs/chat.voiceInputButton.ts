import en from "../../locales/en/chat.voiceInputButton.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "chat.voiceInputButton",
    en,
    (language) => import(`../../locales/${language}/chat.voiceInputButton.json`),
)
