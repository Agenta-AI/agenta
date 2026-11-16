import en from "../../locales/en/entityUi.playgroundConfig.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.playgroundConfig",
    en,
    (language) => import(`../../locales/${language}/entityUi.playgroundConfig.json`),
)
