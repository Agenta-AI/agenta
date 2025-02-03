Client code to communicate with the backend.

Currently the models are manually copied from the backend code. This needs to change.

# Generate Backend

To generate the client code using Fern, follow the steps below. 

1. Open a Terminal and navigate to the folder where this Readme.md file is. For example;
```bash
cd agenta/agenta-cli/agenta/client
```

2. Next ensure you have installed Fern by executing the command;
```bash
npm install -g fern-api
```

3. Execute this command to initialize Fern to import and use the OpenAPI spec;

> To use an OpenAPI spec, you can pass in the filepath or URL.
> We'll need to log in to use fern.
> We'll be using a url to the openapi.json for [Agenta Cloud](https://cloud.agenta.ai).
> Alternatively, for `cloud-dev` we could use [Cloud Local](http://localhost).

```bash
fern init --openapi https://cloud.agenta.ai/api/openapi.json
# fern init --openapi http://localhost/api/openapi.json
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
        version: 0.9.5
        output:
          location: local-file-system
          path: ../sdks/typescript
      - name: fernapi/fern-python-sdk
        version: 0.6.0
```

6. Remove `fernapi/fern-typescript-node-sdk`;
```yaml
default-group: local
groups:
  local:
    generators:
      - name: fernapi/fern-python-sdk
        version: 3.10.6
```

7. Update `fernapi/fern-python-sdk`, which would look like this;
```yaml
default-group: local
groups:
  local:
    generators:
      - name: fernapi/fern-python-sdk
        version: 3.10.6
        output:
          location: local-file-system
          path: ../backend
```
<img width="1001" alt="image" src="https://github.com/Agenta-AI/agenta/assets/56418363/f537691d-8dbb-4363-b7c0-ecef9f464053">


8. Go to the fern.config.json file and change the value of "organization" to `agenta`
<img width="593" alt="image" src="https://github.com/Agenta-AI/agenta/assets/56418363/0f44255e-50b5-4d78-863b-d33a3ec2eea0">

   
9. Generate the client code
```bash
    fern generate
```

10. Go to `./backend/containers/client.py`, search for the `build_image` function in the AgentaApi class and update `timeout_in_seconds` to `600` in `request_options'. It should now look like this;
```python
_response = self._client_wrapper.httpx_client.request(
    "containers/build_image",
    method="POST",
    params={
        "app_id": app_id,
        "base_name": base_name,
    },
    data={},
    files={
        "tar_file": tar_file,
    },
    request_options={**request_options, "timeout_in_seconds": 600},
    omit=OMIT,
)
```
<img width="995" alt="image" src="https://github.com/Agenta-AI/agenta/assets/56418363/8fab19e3-5226-405b-8a6f-4dcb6df588c9">

11. Delete the `./fern` folder.
