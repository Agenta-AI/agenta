import en from "../../locales/en/channels.whatsapp.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "channels.whatsapp",
    en,
    (language) => import(`../../locales/${language}/channels.whatsapp.json`),
)
