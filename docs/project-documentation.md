# Test case knowledge MCP server

A Java [Model Context Protocol](https://modelcontextprotocol.io) server for GitHub Copilot. It reads `.xls` and `.xlsx` test cases from a folder and writes one Word document that explains the product to a newly onboarded reader. Every sentence in that document comes from the workbooks. Source files are never edited.

Maven coordinates: `com.mcptool:testcase-knowledge-java:1.0.0`. Java 17. Main class: `com.mcptool.knowledge.KnowledgeServer`.

## What the user does

1. Put test-case workbooks in `input/` (nested folders are included).
2. Build the jar: `mvn test package`.
3. In Copilot Chat, Agent mode, select **testcase-knowledge-java**.
4. Send: `Generate the product knowledge induction document from the Excel test cases`.
5. Read `output/ProductKnowledgeInduction_yyyyMMdd.docx`.

Stdout is reserved for MCP JSON-RPC. Logs go to stderr with the prefix `[testcase-knowledge-java]`.

A local check that skips Copilot:

```bash
java -jar target/testcase-knowledge-java-1.0.0.jar --generate
```

That uses `TESTCASE_INPUT_DIR` or `./input`, writes into `KNOWLEDGE_OUTPUT_DIR` or `./output`, and prints the output path, test-case count, and product-area count.

The sample workbook generator writes `input/payments.xlsx`:

```bash
mvn -q exec:java -Dexec.mainClass=com.mcptool.knowledge.SampleWorkbook
```

`exec-maven-plugin` is not declared in the POM. The same class can be run after `mvn test-compile` with the project classpath, or the four sample rows can be created by hand. Those rows are Checkout (place order, apply coupon) and Payments (pay by card, reject an expired card).

## Copilot wiring

`.vscode/mcp.json` starts the shaded jar over stdio:

```json
{
  "servers": {
    "testcase-knowledge-java": {
      "type": "stdio",
      "command": "java",
      "args": ["-jar", "${workspaceFolder}/target/testcase-knowledge-java-1.0.0.jar"],
      "env": {
        "TESTCASE_INPUT_DIR": "${workspaceFolder}/input",
        "KNOWLEDGE_OUTPUT_DIR": "${workspaceFolder}/output"
      }
    }
  }
}
```

`.github/agents/testcase-knowledge-java.agent.md` is the Copilot agent. It may call only these tools:

- `testcase-knowledge-java/list_testcases`
- `testcase-knowledge-java/generate_knowledge_document`
- `testcase-knowledge-java/list_output_documents`

Agent procedure when the user asks for the induction document:

1. Call `list_testcases`. Pass `inputFolder` only if the user named a folder. Otherwise the server uses `TESTCASE_INPUT_DIR` or `./input`.
2. If the list shows zero test cases, stop and report skipped files. Do not generate.
3. Call `generate_knowledge_document`. Omit folder arguments unless the user named them.
4. Reply with the output path, test-case count, product-area count, and any skipped files or warnings. State that the document is the induction guide for a newly onboarded reader.

The agent does not invent product behavior and does not edit or delete source workbooks. The server writes the `.docx`. The agent only reports the tool result.

## Tools

All three tools return plain text. Failures set `isError` and return the exception message.

### list_testcases

Optional argument `inputFolder`. Lists readable Excel files, the sheet count that contained test cases, the test-case count, skipped files, and warnings.

### generate_knowledge_document

Optional arguments `inputFolder` and `outputFolder`. Reads every accepted workbook, writes the Word file, and returns the path, test-case count, product-area count, skipped files, and warnings. If no test-case rows are found, generation stops with:

`No Excel test cases were found in <absolute path>. Add .xls or .xlsx workbooks with a header row. CSV files are not accepted.`

### list_output_documents

Optional argument `outputFolder`. Returns absolute paths of `*.docx` files in that folder, sorted by file name. An empty or missing folder returns `No Word documents are in the output folder yet.`

Folder resolution, in order:

1. The tool argument, when it is non-blank.
2. `TESTCASE_INPUT_DIR` for input, `KNOWLEDGE_OUTPUT_DIR` for output.
3. `<user.dir>/input` or `<user.dir>/output`.

The input path must already be a directory. The output directory is created when generating.

## Excel contract

The scanner walks the input folder, skips `.gitkeep`, and sorts paths by their relative name. Backslashes in relative names are stored as `/`.

| Check | Result |
| --- | --- |
| `.xlsx` or `.xls` with a header and data rows | Read |
| Excel lock file (`~$...`) | Skipped: `Excel lock file, ignored.` |
| `.csv` | Skipped: `CSV is not accepted. Save the sheet as .xls or .xlsx.` |
| `.xlsm`, `.xlsb`, or any other file | Skipped: `Only .xls and .xlsx workbooks are accepted.` |
| Larger than 20 MB | Warning: skipped |
| Hidden or very hidden sheet | Warning: skipped |
| Password-protected workbook | Warning: skipped, run continues |
| Unreadable workbook | Warning: skipped, run continues |
| Sheet with no `id` or `title` header in the first 10 rows | Warning: skipped |
| Workbook whose visible sheets yield no rows | Warning: no readable test-case rows |
| No test-case rows in the whole folder | Generate throws and returns an error |

Accepted files are listed even when a later warning skips them (oversize, password, unreadable). Oversize files are not added to the Excel file list.

The header row is the first of the first 10 rows that contains a recognized id or title column. Header matching ignores case, spaces, and punctuation.

| Canonical field | Accepted headers |
| --- | --- |
| id | Test Case ID, TC ID, ID, Test Case No |
| module | Module, Area, Component |
| feature | Feature, Function |
| title | Title, Summary, Test Case Name, Name |
| description | Description, Objective |
| preconditions | Preconditions, Precondition, Prerequisites |
| steps | Steps, Test Steps, Procedure |
| expected | Expected Result, Expected, Expected Outcome |
| priority | Priority |
| type | Type, Test Type, Category |

A row is kept when id or title is non-blank. A blank id becomes `ROW-<1-based Excel row number>`. A blank title falls back to the id. A blank module becomes `General`. Cell values are formatted with Apache POI, including evaluated formulas. Duplicate headers keep the first column.

## Induction document

File name: `output/ProductKnowledgeInduction_yyyyMMdd.docx`. If that name exists, the writer uses `_2`, `_3`, and so on. The date uses `DateTimeFormatter.BASIC_ISO_DATE`.

Page setup uses 0.75 inch margins (1080 twips) on all sides. Letter page width is 12240 twips. Tables are fixed-layout, left-aligned, with explicit column widths in twips. Body font is Calibri. Colors:

| Role | Hex |
| --- | --- |
| Headings and scenario labels | `1F4E79` |
| Body text | `222222` |
| Secondary text | `5B6770` |
| Header row text on navy fill | `FFFFFF` on `1F4E79` |
| Alternate body rows | `F3F6F9` |

Document sections, in order:

1. **Cover.** Centered title `Product Knowledge Induction`, subtitle `For newly onboarded team members`, then a left-aligned sentence with the scenario count and product-area count.
2. **How to use this guide.** Four bullets: start at the product map, read the area you will work in, use the stop-situations table when reviewing a change, and remember that empty workbook fields are omitted.
3. **Product map.** One row per module, in first-seen order. Columns: Product area (1800), What it covers (4200, unique features joined by `, `), Learn these first (4000). Learn-first lists up to three titles whose priority contains `high` (case-insensitive). If none match, it lists the first three titles. A blank feature column shows an em dash.
4. **One section per module.** The opening sentence joins unique descriptions after an em dash. If every description is blank, it joins titles with `; `. Then:
   - **Before you start** — unique non-blank preconditions as bullets, omitted when none exist.
   - **How this area works** — non-guard scenarios. Each shows `id  title  (priority)` when priority is present, the description, a `Do this` label, one bullet per non-blank step line, and `You should see: ` plus the expected result. Blank fields are left out.
   - **What the product must stop** — guard scenarios in a table: ID (1100), Situation (2200, title plus description), What you do (3400, steps), What should happen (3300, expected result).

A scenario is a guard when its type contains `negative`, `boundary`, `invalid`, or `error`. Modules keep the order of first appearance. Empty fields are omitted from prose and shown as blank table cells.

## Architecture

```text
Copilot  --stdio JSON-RPC-->  KnowledgeServer
                                    |
                                    v
                             KnowledgeService
                              /            \
                      ExcelFolder     KnowledgeDocumentWriter
                           |                    |
                      TestCase rows      ProductKnowledgeInduction_*.docx
```

| Type | Responsibility |
| --- | --- |
| `KnowledgeServer` | MCP stdio server and the `--generate` shortcut. Builds the three tools and formats text results. |
| `KnowledgeService` | Resolves folders, scans, generates, and lists `.docx` files. |
| `ExcelFolder` | Walks the tree, rejects non-Excel files, reads workbooks into `TestCase` rows. `ReadBatch` holds file names, sheet count, cases, and skipped names. |
| `KnowledgeDocumentWriter` | Groups rows by module and writes the Word file. `isGuard` and `groupByModule` are package-visible. |
| `TestCase` | One mapped row: source file, sheet, id, module, feature, title, description, preconditions, steps, expected result, priority, type. |
| `FolderScan` | Scan summary returned by `list_testcases`. |
| `GenerateResult` | Path and counts returned after a successful write. |
| `SampleWorkbook` | Standalone writer for `input/payments.xlsx`. |
| `TestCaseFolder` | CSV reader with the same header map and a 5 MB limit. It is not called by `KnowledgeService`. |
| `CsvTable` | Quote-aware CSV parser. Comma and semicolon. Used only by `TestCaseFolder`. |

`log4j2.xml` sends Log4j warnings to stderr. POI must not write to stdout.

The shaded jar is built with `maven-shade-plugin`. The manifest main class is `com.mcptool.knowledge.KnowledgeServer`. Service files are merged. Signature files under `META-INF` are excluded. `createDependencyReducedPom` is false.

Dependencies:

| Artifact | Version | Scope |
| --- | --- | --- |
| `io.modelcontextprotocol.sdk:mcp` | 2.0.0 | compile |
| `org.apache.poi:poi-ooxml` | 5.4.1 | compile |
| `org.apache.logging.log4j:log4j-core` | 2.24.3 | compile |
| `org.junit.jupiter:junit-jupiter` | 5.11.4 | test |

`.gitignore` ignores `target/` and `output/*.docx`. `output/.gitkeep` keeps the output folder.

## Tests

`KnowledgePipelineTest` uses a JUnit temp directory.

| Test | Asserts |
| --- | --- |
| `xlsxBecomesAnInductionDocument` | One `.xlsx` yields 3 cases, 2 modules, a `ProductKnowledgeInduction_` file larger than 1000 bytes. |
| `xlsIsAcceptedAndCsvIsRejected` | `.xls` is read, `.csv` is skipped with `CSV is not accepted`, `rejectionReason` is null for `.xls`, and `canonical("Test Case ID")` is `id`. |
| `folderWithOnlyCsvFailsValidation` | Generate throws `IllegalArgumentException` whose message contains `.xls or .xlsx`. |

The fixture workbook has TC-100 and TC-101 in Checkout (Functional) and TC-301 in Payments (Negative, High).

## Project tree

```text
testcase-knowledge-java/
  pom.xml
  README.md
  .gitignore
  .vscode/mcp.json
  .github/agents/testcase-knowledge-java.agent.md
  docs/
  input/                  workbooks, not modified by the server
  output/                 generated .docx files
  src/main/java/com/mcptool/knowledge/
  src/main/resources/log4j2.xml
  src/test/java/com/mcptool/knowledge/KnowledgePipelineTest.java
```
A simple prompt can draft this kind of document. This project uses a custom agent and an MCP server so the model does not write the document at all.

## What a simple prompt actually does

You attach the workbooks, or paste the rows, and ask the model to explain the product. The model then has to:

- read every test case into its context
- decide what to keep, merge, and skip
- write the full guide back as output

That works for a small sheet and a one-off draft. It gets unreliable as the folder grows. The model can drop rows, merge modules differently each run, and add behavior that is not in the sheet. Word layout (fixed tables, margins, repeated header rows) is also not something a prompt can lock down the same way every time.

## What this project does instead

The Java server reads the Excel files and writes the `.docx`. The model only starts that job and reports the result.

The agent instructions say to call `list_testcases`, then `generate_knowledge_document`, and to reply with the path and the counts. They also say not to invent product behavior. The server, not the chat, writes `ProductKnowledgeInduction_yyyyMMdd.docx`.

So the split is:

| Piece | Job |
| --- | --- |
| MCP server | Local tool Copilot can call. Parses `.xls` / `.xlsx`, applies the skip rules, writes the Word file. No language model inside it. |
| Custom agent | Stops the general chat model from reading the sheets and rewriting the guide itself. |

Without MCP, Copilot has no built-in “run this Java pipeline” tool. Without the custom agent, a general agent often ignores that pipeline and spends the turn summarizing the spreadsheets in chat.

## Which one uses tokens

**The simple prompt uses far more tokens.** Every test-case cell is input, and the whole guide is output. Cost grows with the number of rows, and you pay it again on every run.

**This MCP path uses very few tokens.** Copilot spends tokens on the short user message, the agent instructions, the tool call, and a short reply (file path, counts, skipped files). The workbook text and the Word document never enter the model. That work is ordinary Java and Apache POI, so it costs CPU, not tokens.
