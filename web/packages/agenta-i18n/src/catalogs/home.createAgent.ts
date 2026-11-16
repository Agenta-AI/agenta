import en from "../../locales/en/home.createAgent.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "home.createAgent",
    en,
    (language) => import(`../../locales/${language}/home.createAgent.json`),
)
