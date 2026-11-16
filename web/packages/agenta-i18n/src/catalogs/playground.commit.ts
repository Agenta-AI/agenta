import en from "../../locales/en/playground.commit.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "playground.commit",
    en,
    (language) => import(`../../locales/${language}/playground.commit.json`),
)
