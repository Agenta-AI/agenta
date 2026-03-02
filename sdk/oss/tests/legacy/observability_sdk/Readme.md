# Setup

Create multiple `.env` files containing the following variables:

```
AGENTA_PROJECT_ID=your_project_id
AGENTA_HOST=your_host
AGENTA_APP_ID=your_app_id
AGENTA_API_KEY=your_api_key
```

Create one `.env` file for each environment: `local`, `cloud`, and `oss`. For example:

- `.env.local`
- `.env.cloud`
- `.env.oss`

---

# Install the Requirements

You need to install the requirements for each folder. It is recommended to do this in a virtual environment.

1. **Create a virtual environment:**

   ```bash
   python -m venv .venv
   ```

2. **Activate the virtual environment:**

   ```bash
   source .venv/bin/activate
   ```

3. **Install the required packages:**

   ```bash
   pip install -r requirements.txt
   ```

---

# Running the Scripts

Load the environment variables and run the script. All scripts run locally. The requirements for each folder are specified in `requirements.txt`.

For example, to run the `app_sanity.py` script with the `oss` environment:

```bash
source .env.oss && env $(cat .env.oss | xargs) python app_sanity.py
```

---

# The Tests

## Sanity Check

The tests in the `sanity_check` folder do not use an LLM but test the functionalities of the SDK:

### Functionalities Tested

- **Async Functionality**
  - Works with asynchronous functions.
- **Sync Functionality**
  - Works with synchronous functions.
- **Old SDK Compatibility**
  - Checks if it is instrumenting the config correctly.
- **New SDK Functionality**
  - Checks if it is instrumenting the config correctly.
- **Ignoring Inputs and Outputs**
  - **Inputs:**
    - Some inputs
    - All inputs
  - **Outputs:**
    - Some outputs
    - All outputs
- **Data Types Handling**
  - Works with dictionaries as inputs/outputs.
  - Works with Pydantic models as inputs/outputs.
- **Workflow Types**
  - Works with all types of workflows.
- **Error Handling**
  - Correctly handles errors.

### Tests

#### 01_app_sanity.py

Minimum app to test the functionalities of the SDK.

#### 02_app_local_old_sdk.py

App testing most of the functionalities above but using the old SDK.

#### 03_app_local_new_sdk.py
