import en from "../../locales/en/home.newAgent.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "home.newAgent",
    en,
    (language) => import(`../../locales/${language}/home.newAgent.json`),
)
