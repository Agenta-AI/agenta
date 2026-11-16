import en from "../../locales/en/chat.recordingBar.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "chat.recordingBar",
    en,
    (language) => import(`../../locales/${language}/chat.recordingBar.json`),
)
