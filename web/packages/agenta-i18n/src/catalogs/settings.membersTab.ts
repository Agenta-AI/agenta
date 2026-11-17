import en from "../../locales/en/settings.membersTab.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "settings.membersTab",
    en,
    (language) => import(`../../locales/${language}/settings.membersTab.json`),
)
