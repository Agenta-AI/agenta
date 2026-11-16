import en from "../../locales/en/settings.memberRoles.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "settings.memberRoles",
    en,
    (language) => import(`../../locales/${language}/settings.memberRoles.json`),
)
