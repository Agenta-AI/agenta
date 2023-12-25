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

6. Change the path from this `path: ../generated/typescript` to this path: `../backend`

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
    ```
    <img width="1001" alt="image" src="https://github.com/Agenta-AI/agenta/assets/56418363/f537691d-8dbb-4363-b7c0-ecef9f464053">


7.  Go to the fern.config.json file and change the value of "organization" to `agenta`
    <img width="593" alt="image" src="https://github.com/Agenta-AI/agenta/assets/56418363/0f44255e-50b5-4d78-863b-d33a3ec2eea0">

   
9.  Generate the client code
   
    ```bash
        fern generate
    ```

10.  Change the timeout for the build_image function endpoint
    Go to the client.py in the generated code folder search for the `build_image` function in the AgentaApi class and change the timeout to 600.
    When done, it should look like this;
    <img width="995" alt="image" src="https://github.com/Agenta-AI/agenta/assets/56418363/8fab19e3-5226-405b-8a6f-4dcb6df588c9">



11. Delete the fern folder.
