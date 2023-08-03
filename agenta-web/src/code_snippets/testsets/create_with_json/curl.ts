export default function cURLCode(uri: string, params: string): string {
    return `curl -X POST ${uri} \
-H 'Content-Type: application/json' \
-d '{
        "name": "your_testset_name",
        "csvdata": [
            {"column1": "value1", "column2": "value2"},
            {"column1": "value3", "column2": "value4"}
        ]
    }'`
}
