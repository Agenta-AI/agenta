import en from "../../locales/en/settings.members.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "settings.members",
    en,
    (language) => import(`../../locales/${language}/settings.members.json`),
)
