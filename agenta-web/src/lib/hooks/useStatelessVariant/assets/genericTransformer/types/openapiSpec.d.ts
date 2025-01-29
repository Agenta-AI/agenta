import {ObjectSchema} from "./schema"

export interface OpenAPISpec {
    paths: {
        [path: string]: {
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
    }
}
