import en from "../../locales/en/home.composer.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "home.composer",
    en,
    (language) => import(`../../locales/${language}/home.composer.json`),
)
