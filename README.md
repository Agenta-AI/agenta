# **✨ Agenta Lab**
### **The developer-first open source LLMOps platform.**


Building LLM-powered apps is currently very frustrating. It involves a significant amount of prompt engineering and a lots of parameters to tune and countless iterations. Agenta Lab simplifies this process, enabling you to quickly iterate, experiment, and optimize your LLM apps. All without imposing any restrictions on your choice of framework, library, or model.

## How Agenta Lab works:
1. Develop your LLM-powered application as you would normally do. Feel free to use any framework, library, or model (langchain, llma_index, GPT-3, or open-source models).
2. With two lines of code, specify the parameters for your experiment.
3. Deploy your app using the Agenta CLI.
4. You or your team can iterate, version parameters, test different versions, and run systematic evaluations via a user-friendly web platform.

In the future, we plan to extend Agenta Lab to facilitate your LLM-app development further, providing features for deployment, monitoring, logging, and A/B testing.

## Features of Agenta Lab

- **Parameter Playground:** With just a few lines of code, define the parameters you wish to experiment with. Through our user-friendly web platform, you or your team can then experiment and tweak these parameters.

- **Version Evaluation:** Define test sets, evaluate, and compare different app versions.

- **API Deployment Made Easy:** Agenta Lab allows you to deploy your LLM applications as APIs without any additional effort. (Currently only available locally)
## Documentation

Please go to [docs.agenta.ai](https://docs.agenta.ai) for full documentation on:
- [Installation](https://docs.agenta.ai/docs/installation)
- [Getting Started](https://docs.agenta.ai/docs/getting-started)
- [Tutorials](https://docs.agenta.ai/docs/tutorials)
## Getting Started

### Requirements

Agenta Lab requires Docker installed on your machine. If you don't have Docker, you can install it from [here](https://docs.docker.com/get-docker/).

### Installation

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

![Screenshot 2023-05-31 at 17 42 19](https://github.com/Agenta-AI/agenta/assets/4510758/ab7c10f0-6efd-4c30-8575-91adcd345aac)

This will create a new project in your folder with the following structure:

```bash
.
├── README.md         // How to use the template
├── app.py            // the code of the app
├── config.toml      
└── requirements.txt
```

The app created uses a simple prompt template in [langchain](https://python.langchain.com/en/latest/getting_started/getting_started.html) and gpt-3.5 to generate names for companies that makes `{product}` 

If you are interested using your own code in Agenta Lab, please see this tutorial on [writing you first LLM-app with Agenta Lab](https://docs.agenta.ai/docs/tutorials/your-first-llm-app)

#### 3. Write your app and deploy it

Create a `.env` file with you open api key in the same folder as asked in `README.md`

Before adding the app to Agenta Lab, you can test it in your terminal

```bash
python app.py "colorful socks"

Feetful of Fun
```

Now let's procede to add the app [variant](https://docs.agenta.ai/docs/conceptual/concepts#app-variant) to Agenta Lab. 


```bash
agenta variant serve
```

This command will do two things:
1) Package the code and serve it locally as an api endpoint under `localhost/app_name/{variant_name}/openapi.json`.
2) Add the code to the Agenta web platform

#### 4. Start experimenting

Navigate to localhost:3000, select your app, and begin experimenting with the parameters we exposed in the code in the playground.

<img width="1263" alt="Screenshot 2023-05-31 at 19 06 09" src="https://github.com/Agenta-AI/agenta/assets/4510758/6283d5af-0337-479f-951d-e7560c16d6ec">

You can fork new [variants](https://docs.agenta.ai/docs/conceptual/concepts#app-variant), run batch evalutions, and more.

## Why choose Agenta Lab for building LLM-apps?

While there are numerous LLMops platforms, we believe Agenta Lab offers unique benefits:

- Developer-Friendly: We cater to complex LLM-apps and pipelines that require more than just a few no-code abstractions. We give you the freedom to develop your apps the way you want.
- Privacy-First: We respect your privacy and do not proxy your data through third-party services. You have the choice to host your data and models.
- Solution-Agnostic: You have the freedom to use any library and models, be it Langchain, llma_index, or a custom-written alternative.
- Collaborative: We recognize that building LLM-powered apps requires the collaboration of developers and domain experts. Our tool enables this collaboration, allowing domain experts to edit and modify parameters (e.g., prompts, hyperparameters, etc.), and label results for evaluation.
- Open-Source: We encourage you to contribute to the platform and customize it to suit your needs.

## Roadmap 

Currently, we support Q&A applications (no chat) and do not yet support persistent data (like using a persistent vector database). Our future plans include:

- Supporting chat applications.
- Support for persistent data and vector databases.
- Automated Deployment: Enable automatic app deployment with a simple commit.
- Monitoring and Logging: Introduce a dashboard to monitor your app's performance and usage.
- A/B Testing & User Feedback: Allow for experimentation with different app versions and collect user feedback.
- Regression Testing: Introduce regression tests based on real data for each new version deployment.

## Contributing

We warmly welcome contributions to Agenta Lab. Feel free to submit issues, fork the repository, and send pull requests.

### How can you help
- Designers, UI/UX and Frontend Developers: We need your expertise to enhance the UI/UX of the dashboard and the CLI. We also need help with improving the frontend of the dashboard. Feel free to fork and submit a PR. For bigger ideas, you can contact us via Discord or email (team@agenta.ai).
