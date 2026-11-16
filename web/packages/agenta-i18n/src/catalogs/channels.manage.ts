import en from "../../locales/en/channels.manage.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "channels.manage",
    en,
    (language) => import(`../../locales/${language}/channels.manage.json`),
)
