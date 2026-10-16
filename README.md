# Test case knowledge MCP server (Java)

A small [Model Context Protocol](https://modelcontextprotocol.io) server for GitHub Copilot. It reads `.xls` and `.xlsx` test cases from an input folder and writes a product-knowledge induction Word document. A newly onboarded person can read that document and learn what the product does.

## Flow

1. You select **testcase-knowledge-java** in the Copilot agent dropdown.
2. Copilot starts this Java process from `.vscode/mcp.json`.
3. The agent calls `list_testcases`, then `generate_knowledge_document`.
4. The server accepts only `.xls` and `.xlsx`. CSV and other files are skipped with a reason.
5. It writes `output/ProductKnowledgeInduction_yyyyMMdd.docx`.

Stdout is reserved for MCP messages. Logs go to stderr.

## Build

From `testcase-knowledge-java`:

```bash
mvn test package
```

Check the writer without Copilot:

```bash
java -jar target/testcase-knowledge-java-1.0.0.jar --generate
```

## Excel rules

Put workbooks in `input/`. Nested folders are included. The first rows are searched for a header. These names are recognized, with or without spaces: Test Case ID, Module, Feature, Title, Description, Preconditions, Steps, Expected Result, Priority, Type.

| Check | Result |
| --- | --- |
| `.xlsx` or `.xls` with a header and data rows | Read |
| `.csv`, `.xlsm`, or any other file | Skipped, with the reason in the tool result |
| Excel lock file (`~$...`) | Skipped |
| Hidden sheet | Skipped |
| Password-protected or unreadable workbook | Skipped, and the run continues |
| File larger than 20 MB | Skipped |
| No `.xls` or `.xlsx` test cases | Generate stops and reports that |

Source workbooks are not edited.

## Induction document

The Word file is written for someone new to the product:

- Cover: Product Knowledge Induction, for newly onboarded team members
- How to use the guide
- Product map: each area, what it covers, and the high-priority scenarios to learn first
- Each product area: what it does, what must already be true, the step-by-step behavior, and the situations the product must stop

Wording comes from the test-case description, preconditions, steps, and expected result. The page uses 0.75 inch margins, a centered title, and fixed-width left-aligned tables.

## Copilot

1. Build the jar so `.vscode/mcp.json` can start it.
2. Open Copilot Chat in **Agent** mode.
3. Select **testcase-knowledge-java**.
4. Start the server from `.vscode/mcp.json` the first time.
5. Send: `Generate the product knowledge induction document from the Excel test cases`.
