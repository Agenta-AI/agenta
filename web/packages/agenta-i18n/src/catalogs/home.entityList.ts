import en from "../../locales/en/home.entityList.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "home.entityList",
    en,
    (language) => import(`../../locales/${language}/home.entityList.json`),
)
