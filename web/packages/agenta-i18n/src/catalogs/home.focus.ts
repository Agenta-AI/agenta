import en from "../../locales/en/home.focus.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "home.focus",
    en,
    (language) => import(`../../locales/${language}/home.focus.json`),
)
