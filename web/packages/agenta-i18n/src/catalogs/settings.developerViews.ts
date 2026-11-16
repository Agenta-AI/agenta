import en from "../../locales/en/settings.developerViews.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "settings.developerViews",
    en,
    (language) => import(`../../locales/${language}/settings.developerViews.json`),
)
