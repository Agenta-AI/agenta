import en from "../../locales/en/channels.panel.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "channels.panel",
    en,
    (language) => import(`../../locales/${language}/channels.panel.json`),
)
