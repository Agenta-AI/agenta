import en from "../../locales/en/settings.states.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "settings.states",
    en,
    (language) => import(`../../locales/${language}/settings.states.json`),
)
