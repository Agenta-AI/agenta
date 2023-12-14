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
> We'll be using a url to the openapi.json running locally in Agenta Backend. If Agenta is not running on your Computer, start it by executing the command in the root of the agenta repository `docker compose -f "docker-compose.yml" up -d --build` 

    ```bash
        fern init --openapi http://localhost/api/openapi.json
    ```

3. Run `fern check` to validate the OpenAPI spec and resolve any errors, if there are any. 
   
4. Add the Fern Python SDK;
   ```bash
        fern add fern-python-sdk
    ```

At this stage, you should have a folder named "fern" with the following directory;

    ```
        fern/
            ├─ fern.config.json
            ├─ generators.yml
            openapi/
                ├─ openapi.yml
    ```

5. Your generators.yml would look like this;

    ```
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

    ```
        - name: fernapi/fern-typescript-node-sdk
        version: 0.7.2
    ```

    with this;

    ```
       - name: fernapi/fern-python-sdk
         version: 0.6.0
    ```

    Also, change the path and path name to reflect the path name of python sdj appropriately and change the path to where you want the generate code to be. 
    For example change it from this `path: ../generated/typescript` to this path: `../backend`

    Now your generators.yml should look like this;
    ```
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

6. Generate the client code
   
    ```
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
> - Click on the button beside the Replace box to replace every instance of the target with the new value. 

Afterwards you can delete the fern folder, if you so wish. 
