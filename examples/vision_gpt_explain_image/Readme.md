# Image Comparison Application Using GPT-4 Vision

This application enables you to compare two images utilizing the power of GPT-4 Vision.

## Getting Started

Follow these simple steps to set up the application on your system:

### 1. Set Up Your Workspace

- **Create a New Folder:** Start by creating a new folder on your computer.
- **Copy Files:** Copy the application files into this new folder.

### 2. Configuration

- **Generate OPENAI API Key:** Ensure you have an OPENAI API key. Store this key in a `.env` file within your folder as `OPENAI_API_KEY=your_api_key_here`.
- **Get Agenta API Key:** Visit Agenta Cloud to generate an API key for accessing its services.

### 3. Installation

- **Install Agenta:** Open your terminal and run the command `pip install agenta` to install the Agenta package.

### 4. Initialization

- **Initialize Agenta:** Run `agent init` in the terminal. When prompted, choose `cloud` and enter your Agenta API key. If asked about starting from a template, select `start from blank`.

### 5. Deploy Your Application

- **Serve Application:** Execute `agenta variant serve app.py` in the terminal. This command prepares your application for deployment by building a container and creating an API endpoint for it.

Now, your application is ready to compare images using GPT-4 Vision through the deployed API endpoint.

