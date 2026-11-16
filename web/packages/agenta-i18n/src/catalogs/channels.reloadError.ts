import en from "../../locales/en/channels.reloadError.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "channels.reloadError",
    en,
    (language) => import(`../../locales/${language}/channels.reloadError.json`),
)
