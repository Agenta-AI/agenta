import en from "../../locales/en/home.greeting.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "home.greeting",
    en,
    (language) => import(`../../locales/${language}/home.greeting.json`),
)
