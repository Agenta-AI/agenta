Client code to communicate with the backend.

Currently the models are manually copied from the backend code. This needs to change.

# Generate Backend

To generate the client code using Fern, follow the steps below. 

1. Open a Terminal and navigate to the folder where this Readme.md file is. For example;
    ```
    $ cd agenta/agenta-cli/agenta/client
    ```

2. Next ensure you have installed Fern by executing the command;
    ```
    $ npm install -g fern-api
    ```
3. Execute this command to initialize Fern to import and use the OpenAPI spec;

> To use an OpenAPI spec, you can pass in the filepath or URL.
> We'll be using a url to the openapi.json for [Agenta Cloud](https://cloud.agenta.ai)

```
fern init --openapi https://cloud.agenta.ai/api/openapi.json
```    
   
4. Add the Fern Python SDK;
   ```bash
   fern add fern-python-sdk
   ```

5. Go to the generators.yml, which would look like this;

    ```yaml
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

    ```yaml
      - name: fernapi/fern-typescript-node-sdk
        version: 0.7.2
    ```

    with this and delete it from the bottom of the file after;

    ```yaml
      - name: fernapi/fern-python-sdk
        version: 0.6.0
    ```

6. Set timeout.
    > Default timeout is 60 seconds but some operations in the CLI can take longer
    Configure the python sdk to use a specified timeout by adding this configuration.
    ```yaml
        config:
          timeout_in_seconds: 600
    ```

7. Change the path from this `path: ../generated/typescript` to this path: `../backend`

    Now your generators.yml should look like this;
    ```yaml
    default-group: local
    groups:
      local:
        generators:
          - name: fernapi/fern-python-sdk
            version: 0.6.0
            output:
              location: local-file-system
              path: ../backend
            config:
              timeout_in_seconds: 600
    ```

8.  Go to the fern.config.json file and change the value of "organization" to `agenta`
   
9.  Generate the client code
   
    ```bash
        fern generate
    ```

10. Delete the fern folder.