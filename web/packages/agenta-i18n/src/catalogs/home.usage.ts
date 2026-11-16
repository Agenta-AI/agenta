import en from "../../locales/en/home.usage.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "home.usage",
    en,
    (language) => import(`../../locales/${language}/home.usage.json`),
)
