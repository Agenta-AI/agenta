import en from "../../locales/en/home.screen.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "home.screen",
    en,
    (language) => import(`../../locales/${language}/home.screen.json`),
)
