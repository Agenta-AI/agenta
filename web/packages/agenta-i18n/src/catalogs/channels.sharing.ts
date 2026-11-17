import en from "../../locales/en/channels.sharing.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "channels.sharing",
    en,
    (language) => import(`../../locales/${language}/channels.sharing.json`),
)
