import en from "../../locales/en/channels.status.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "channels.status",
    en,
    (language) => import(`../../locales/${language}/channels.status.json`),
)
