import en from "../../locales/en/channels.list.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "channels.list",
    en,
    (language) => import(`../../locales/${language}/channels.list.json`),
)
