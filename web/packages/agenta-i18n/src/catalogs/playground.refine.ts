import en from "../../locales/en/playground.refine.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "playground.refine",
    en,
    (language) => import(`../../locales/${language}/playground.refine.json`),
)
