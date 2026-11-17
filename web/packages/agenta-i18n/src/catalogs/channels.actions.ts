import en from "../../locales/en/channels.actions.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "channels.actions",
    en,
    (language) => import(`../../locales/${language}/channels.actions.json`),
)
