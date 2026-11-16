import en from "../../locales/en/playground.evaluator.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "playground.evaluator",
    en,
    (language) => import(`../../locales/${language}/playground.evaluator.json`),
)
