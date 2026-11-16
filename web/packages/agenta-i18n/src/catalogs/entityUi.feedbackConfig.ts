import en from "../../locales/en/entityUi.feedbackConfig.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.feedbackConfig",
    en,
    (language) => import(`../../locales/${language}/entityUi.feedbackConfig.json`),
)
