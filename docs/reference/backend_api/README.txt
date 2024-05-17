To generate the reference documentation:
- Add the openapi.json to this folder
- Add the following to the openapi.json
    "servers": [
        {
            "url": "https://cloud.agenta.ai/api",
            "description": "Agenta Cloud"
        },
        {
            "url": "http:/localhost/api",
            "description": "Local Development"
        }
    ],
- Run ./create_doc_from_openapi.sh
- Add the output of the script to mint.json
- Make sure that
  "openapi": [
    "/reference/backend_api/openapi.json"
  ],

is in the mint.json