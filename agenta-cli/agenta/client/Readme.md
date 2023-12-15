Client code to communicate with the backend.

Currently the models are manually copied from the backend code. This needs to change.

# Generate Backend

To generate the client code using Fern, follow the steps below. 

1. Next ensure you have installed Fern by executing the command;
    ```bash
        $ npm install -g fern-api
    ```
2. Execute this command to initialize Fern to import and use the OpenAPI spec;

> To use an OpenAPI spec, you can pass in the filepath or URL.
> We'll be using a url to the openapi.json for Aggenta at https://cloud.agenta.ai.

    ```bash
        fern init --openapi https://cloud.agenta.ai/api/openapi.json
    ```

1. Add Security Definition to the openapi.json
   
    At this stage, you should have a folder named "fern" with the following directory;

        ```bash
            fern/
                ├─ fern.config.json
                ├─ generators.yml
                openapi/
                    ├─ openapi.yml
        ```

    - Go to the openapi.json.
    - Go to components and add the following new schema;
        ```bash
            securitySchemes:
                APIKeyHeader:
                type: apiKey
                in: header
                name: Authorization
        ```
    - At the last empty line in the bottom of the file, add this;
        ```bash
            security:
            - APIKeyHeader: []
        ```
    

4. Run `fern check` to validate the OpenAPI spec and resolve any errors, if there are any. ( You can ignore the conflicting endpoints warnings. )
   
5. Add the Fern Python SDK;
   ```bash
        fern add fern-python-sdk
    ```

6. Go to the generators.yml, which would look like this;

    ```bash
        default-group: local
        groups:
        local:
            generators:
            - name: fernapi/fern-typescript-node-sdk
                version: 0.7.2
                output:
                  location: local-file-system
                  path: ../generated/typescript
            - name: fernapi/fern-python-sdk
                version: 0.6.0
    ```

    Replace the following;

    ```bash
        - name: fernapi/fern-typescript-node-sdk
          version: 0.7.2
    ```

    with this;

    ```bash
       - name: fernapi/fern-python-sdk
         version: 0.6.0
    ```

    Also, change the path and path name to reflect the path name of python sdj appropriately and change the path to where you want the generate code to be. 
    For example change it from this `path: ../generated/typescript` to this path: `../backend`

    Now your generators.yml should look like this;
    ```bash
        default-group: local
        groups:
        local:
            generators:
            - name: fernapi/fern-python-sdk
                version: 0.6.0
                output:
                  location: local-file-system
                  path: ../backend
    ```

7. Generate the client code
   
    ```bash
        fern generate
    ```

After generation, go the client.py file of the generated code and check the name of the classese. Most likely it'll be named of your Terminal User, for example `DevgenixApi` and `AsyncDevgenixApi`. 
Now change every instance where `DevgenixApi` appears to `AgentaApi`, and `AsyncDevgenixApi` to `AsyncAgentaApi`

> In VS code, you can do easily do this by 
> - Click on the search Icon 
> - Enter either of `DevgenixApi` or `AsyncDevgenixApi`
> - Click on the '>' symbol next to the search field and enter the value to replace it. For `DevgenixApi` enter `AgengaApi`, for `AsyncDevgenixApi` enter `AsyncAgentaApi`
> - Click on the horizontal elipse icon at the bottom right of the Replace box. 
> - Specify the path to the generated code in the "files to include" box. For example `./agenta/agenta-cli/agenta/client/backend`
> - It should look something like this;
> - <img width="397" alt="Screenshot 2023-12-14 at 02 22 54" src="https://github.com/devgenix/agenta/assets/56418363/e4762c79-d4c0-4b8d-ad6a-e9bd20ddc8b1">

> - Click on the button beside the Replace box to replace every instance of the target with the new value. 

Afterwards you can delete the fern folder, if you so wish. 
