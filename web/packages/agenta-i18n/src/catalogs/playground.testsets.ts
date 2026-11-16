import en from "../../locales/en/playground.testsets.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "playground.testsets",
    en,
    (language) => import(`../../locales/${language}/playground.testsets.json`),
)
