import en from "../../locales/en/settings.projects.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "settings.projects",
    en,
    (language) => import(`../../locales/${language}/settings.projects.json`),
)
