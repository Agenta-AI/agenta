import en from "../../locales/en/channels.page.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "channels.page",
    en,
    (language) => import(`../../locales/${language}/channels.page.json`),
)
