import en from "../../locales/en/home.overview.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "home.overview",
    en,
    (language) => import(`../../locales/${language}/home.overview.json`),
)
