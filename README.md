# Agenta: Streamline Your LLM-Powered App Development

Agenta is an open-source CI/CD platform designed to simplify and accelerate the development and deployment of LLM-powered applications such as chatbots, agents, Q&A systems, and more. By connecting Agenta to your GitHub repository, you gain access to a comprehensive set of tools that streamline your workflow.

## Key Benefits
- Automated Deployment: Push a commit to automatically deploy your app, saving time and minimizing human error.
- App Evaluation: Test and compare app performance with regression tests, output comparisons, and intermediate output analysis.
- A/B Testing & User Feedback: Experiment with different app versions and gather valuable user feedback for continuous improvement.
- Workflow Management: Launch evaluations, benchmarking, and labeling workflows to make informed decisions and ensure the quality of your app.
- Local Deployment: Deploy your app locally along with the required vector database for seamless integration.

Please note that some features mentioned above are part of our future roadmap. Currently, Agenta supports monitoring, logging, and evaluations.

Follow the steps below for installation and testing instructions.

## Installation

- Clone this repository to your local machine.
- Create a .env file in the root directory with the following variables:

```makefile
OPENAI_API_KEY=sk-XXXXXXXXXXXXXXXXXXXXXXXX
```

Replace XXXXXXXXXXXXXXXXXXXXXXXX with your actual OpenAI API key.

## Running

To start Agenta, run the following command:

```docker compose up```

This command starts a MongoDB instance and the API on port 8000.

## Testing

To test the API, open your browser and navigate to:

```bash

localhost:8000/docs
```
To test the MongoDB instance, open your browser and navigate to:

```makefile

localhost:8081
```
#Contributing

We welcome contributions to help us improve and expand Agenta. Please feel free to submit issues, fork the repository, and send pull requests.
