import {ObjectSchema} from "./schema"

export interface OpenAPISpec {
    paths: Record<
        string,
        {
            post: {
                requestBody: {
                    content: {
                        "application/json": {
                            schema: ObjectSchema
                        }
                    }
                }
            }
        }
    >
}
