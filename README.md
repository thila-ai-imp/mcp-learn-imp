# KnowledgeAgent

KnowledgeAgent is a VS Code plugin. It runs the custom agents in `.github/agents` on the GenAI model from the GitHub Copilot sign-in already in VS Code. No model API key and no Copilot CLI.

## Use it

1. Open this folder in VS Code. Install the GitHub Copilot extension and sign in, if you have not already.
2. From the project folder, once: `npm install`.
3. Press **F5** (the **Run KnowledgeAgent** launch). A second VS Code window opens. You do not install the plugin to test it.
4. The KnowledgeAgent page opens in that window. If it does not, press `Ctrl+Shift+P` and run **KnowledgeAgent: Open**.
5. If VS Code asks whether KnowledgeAgent may use Copilot, allow it.
6. Choose the `.xlsx` file and the custom agent **TestDoc Knowledge Writer**, then press **Generate document**. Progress and the **Download** button stay on this page.

Node.js 18+ must be on PATH. The extension uses it only to read the Excel file and build the Word file. Copilot in VS Code writes the analysis.

## How it works

```
KnowledgeAgent page in VS Code
   1. node read-excel.cjs            -> .testdoc/work/parts/*.md
   2. vscode.lm (your Copilot sign-in) writes each analysis JSON
   3. Copilot writes overview.json
   4. node build-docx.cjs            -> .testdoc/output/*.docx
The page shows progress and Download.
```

Large workbooks are split into parts of 40 test cases so every step fits in the context window.

## Proxy

Copilot traffic uses the proxy already configured for VS Code. Excel reading and Word building stay on this machine.

## Token usage

The page shows the token counts Copilot reports. When Copilot does not report a count, the number is an estimate of about 4 characters per token.

## Add your own agent

Copy `testdoc-knowledge.agent.md`, rename it, change `name`, the JSON instructions and the `--sections` / `--suffix` values in step 5. It appears in the web UI dropdown (every `.github/agents/*.agent.md` file).
Allowed sections: `flows, businessRules, validations, dependencies, testCases`.

## If it does not work

- The page says to sign in: use the GitHub Copilot extension in this VS Code window, allow KnowledgeAgent when asked, then run **KnowledgeAgent: Open** again.
- No agents found: open the folder that contains `.github`, then run **KnowledgeAgent: Open** again.
- Node.js was not found: install Node.js 18 or newer and start VS Code again.
