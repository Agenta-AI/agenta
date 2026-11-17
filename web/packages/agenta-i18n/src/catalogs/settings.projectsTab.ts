import en from "../../locales/en/settings.projectsTab.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "settings.projectsTab",
    en,
    (language) => import(`../../locales/${language}/settings.projectsTab.json`),
)
