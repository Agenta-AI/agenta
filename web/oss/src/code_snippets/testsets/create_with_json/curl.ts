import {isDemo} from "@/oss/lib/helpers/utils"

export default function cURLCode(uri: string, params: string): string {
    return `curl -X POST ${uri} \
-H 'Content-Type: application/json' \
 ${!isDemo() ? "" : "-H 'Authorization: your_api_key'"} \
-d '{
        "testset": {
            "slug": "your-testset-slug",
            "name": "your_testset_name",
            "data": {
                "testcases": [
                    {"data": {"column1": "value1", "column2": "value2"}},
                    {"data": {"column1": "value3", "column2": "value4"}}
                ]
            }
        }
    }'`
}
