import en from "../../locales/en/playground.runs.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "playground.runs",
    en,
    (language) => import(`../../locales/${language}/playground.runs.json`),
)
