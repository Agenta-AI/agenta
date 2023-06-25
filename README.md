![37 copy](https://github.com/Agenta-AI/agenta/assets/4510758/762d4838-f56f-4773-94a7-38ae417ca439)

[![Twitter Follow](https://img.shields.io/twitter/follow/agenta_ai?style=social)](https://twitter.com/agenta_ai)
### **The developer-first open source LLMOps platform.**


Building production-ready LLM-powered applications is currently very difficult. It involves countless iterations of prompt engineering, parameter tuning, and architectures.

Agenta provides you with the tools to quickly 🔄 **iterate**, 🧪 **experiment**, and ⚖️ **evaluate** your LLM apps. All without imposing any restrictions on your choice of framework, library, or model.



https://github.com/Agenta-AI/agenta/assets/57623556/99733147-2b78-4b95-852f-67475e4ce9ed



## How Agenta works:
<details closed><summary>Write your LLM-powered application as you would normally do. Feel free to use any framework, library, or model (langchain or llma_index, GPT-4 or Falcon).</summary>
<br/>

_Example simple application that generates baby names_
```python
    from jinja2 import Template
    import openai
    template = Template(prompt_template)
    prompt = template.render(country=country, gender=gender)

    openai.api_key = os.environ.get("OPENAI_API_KEY")  # make sure to set this manually!
    chat_completion = openai.ChatCompletion.create(
        model="gpt-3.5-turbo", messages=[{"role": "user", "content": prompt}])

    print(chat_completion.choices[0].message.content)
```

</details>
<details open> <summary>With two lines of code, specify the inputs and parameters for your experiment.</summary>
<br/>
  
```python
import agenta as ag
default_prompt = "Give me five cool names for a baby from {{country}} with this gender {{gender}}!!!!"
@ag.post
def generate(country: str, gender: str, temperature: ag.FloatParam = 0.9, prompt_template: ag.TextParam = default_prompt) -> str:
# rest of the code
```
  </details>

<details closed> <summary>Deploy your app using the Agenta CLI.</summary>
  <br/>
<img width="722" alt="Screenshot 2023-06-19 at 15 58 34" src="https://github.com/Agenta-AI/agenta/assets/4510758/eede3e78-0fe1-42a0-ad4e-d880ddb10bf0">
  </details>

<details open> <summary>Now your team can 🔄 iterate, 🧪 experiment, and ⚖️ evaluate different versions of your app (with your code!) in the web platform.</summary>
  <br/>
<img width="907" alt="Screenshot 2023-06-19 at 15 57 08" src="https://github.com/Agenta-AI/agenta/assets/4510758/be2e8c9f-c65a-4670-83eb-751a1b4a39ea">
</details>

## Features

- 🪄 **Playground:** With just a few lines of code, define the parameters and prompts you wish to experiment with. You and your team can quickly experiment and fork new versions on the web UI.

- 📊 **Version Evaluation:** Define test sets, evaluate, and A/B test app versions.

- 🚀 **API Deployment Made Easy:** When you are ready, deploy your LLM applications as APIs in one click.
  
## Documentation

Please go to [docs.agenta.ai](https://docs.agenta.ai) for full documentation on:
- [Installation](https://docs.agenta.ai/docs/installation)
- [Getting Started](https://docs.agenta.ai/docs/getting-started)
- [Tutorials](https://docs.agenta.ai/docs/tutorials)
  
## Getting Started

### Requirements

Agenta requires Docker installed on your machine. If you don't have Docker, you can install it from [here](https://docs.docker.com/get-docker/).

### Installation SDK

```bash
pip install agenta
```

### Usage

#### 0. Clone repository and cd into it

```bash
git clone https://github.com/Agenta-AI/agenta.git
cd agenta
```

#### 1. Start the agenta server

```bash
docker compose -f "docker-compose.yml" up -d --build
```

#### 2. Create a new project

Create an empty folder and use the following command to initialize a new project. 

```bash
mkdir example_app; cd example_app
agenta init
```

Start a new project based on the [template](https://docs.agenta.ai/docs/conceptual/concepts#templates) `simple_prompt`:

![carbon(7)](https://github.com/Agenta-AI/agenta/assets/4510758/2a0aa528-846c-43c3-b3e7-30349b6fa0fe)


This will create a new project in your folder with the following structure:

```bash
.
├── README.md         // How to use the template
├── app.py            // the code of the app
├── config.toml      
└── requirements.txt
```

The app created uses a simple prompt template in [langchain](https://python.langchain.com/en/latest/getting_started/getting_started.html) and gpt-3.5 to generate names for companies that makes `{product}` 

If you are interested using your own code in Agenta, please see this tutorial on [writing you first LLM-app with Agenta](https://docs.agenta.ai/docs/tutorials/your-first-llm-app)

#### 3. Write your app and deploy it

Create a `.env` file with your open api key in the same folder as asked in `README.md`: `OPENAI_API_KEY= <your-openai-api-key>`

Before adding the app to Agenta, you can test it in your terminal

```bash
python app.py "colorful socks"

Feetful of Fun
```

Now let's procede to add the app [variant](https://docs.agenta.ai/docs/conceptual/concepts#app-variant) to Agenta. 

```bash
agenta variant serve
```

![carbon(6)](https://github.com/Agenta-AI/agenta/assets/4510758/cc3cefab-1bd0-479f-a54a-ce8f60ae14ae)


This command will do two things:
1) Package the code and serve it locally as an api endpoint under `localhost/app_name/{variant_name}/openapi.json`.
2) Add the code to the Agenta web platform

#### 4. Start experimenting

Navigate to localhost:3000, select your app, and begin experimenting with the parameters we exposed in the code in the playground.

You can fork new [variants](https://docs.agenta.ai/docs/conceptual/concepts#app-variant), run batch evaluations, and more.

<img width="907" alt="Screenshot 2023-06-19 at 15 57 08" src="https://github.com/Agenta-AI/agenta/assets/4510758/be2e8c9f-c65a-4670-83eb-751a1b4a39ea">


## Why choose Agenta for building LLM-apps?

- 🔨 **Build quickly**: You need to iterate many times on different architectures and prompts to bring apps to production. We streamline this process and allow you to do this in days instead of weeks.
- 🏗️ **Build robust apps and reduce hallucination**: We provide you with the tools to systematically and easily evaluate your application to make sure you only serve robust apps to production
- 👨‍💻 **Developer-focused**: We cater to complex LLM-apps and pipelines that require more than one simple prompt. We allow you to experiment and iterate on apps that have complex integration, business logic, and many prompts.
- 🌐 **Solution-Agnostic**: You have the freedom to use any library and models, be it Langchain, llma_index, or a custom-written alternative.
- 🔒 **Privacy-First**: We respect your privacy and do not proxy your data through third-party services. The platform and the data are hosted on your infrastructure.

## Contributing

We warmly welcome contributions to Agenta. Feel free to submit issues, fork the repository, and send pull requests.

