# Prompt: generate the complete project

Paste everything below the line into a coding agent. The agent should create the project from this specification and stop when `mvn test package` passes.

---

Create a Java 17 Maven project named `testcase-knowledge-java` that is a Model Context Protocol server. It reads `.xls` and `.xlsx` test cases from a folder and writes one Word document that explains the product to a newly onboarded reader. Wording in that document comes only from the workbooks. Never modify source workbooks. Stdout is reserved for MCP JSON-RPC. All logs go to stderr.

Do not add frameworks, extra tools, or features beyond this specification. Match the package, class names, tool names, messages, and file layout below.

## Maven

`pom.xml`:

- `groupId` `com.mcptool`, `artifactId` `testcase-knowledge-java`, `version` `1.0.0`
- `name` `testcase-knowledge-java`
- `description`: `Beginner MCP server: Excel test cases to a product-knowledge induction document.`
- `maven.compiler.release` 17, encoding UTF-8
- Dependencies: `io.modelcontextprotocol.sdk:mcp:2.0.0`, `org.apache.poi:poi-ooxml:5.4.1`, `org.apache.logging.log4j:log4j-core:2.24.3`, `org.junit.jupiter:junit-jupiter:5.11.4` (test)
- Plugins: `maven-compiler-plugin` 3.13.0, `maven-surefire-plugin` 3.5.2, `maven-shade-plugin` 3.6.0 bound to `package`
- Shade: `createDependencyReducedPom` false, manifest main class `com.mcptool.knowledge.KnowledgeServer`, `ServicesResourceTransformer`, exclude `META-INF/*.SF`, `META-INF/*.DSA`, `META-INF/*.RSA`

## Files outside Java

`.gitignore`:

```text
target/
output/*.docx
```

Create `output/.gitkeep` and `input/` (the sample workbook may be generated later).

`.vscode/mcp.json`:

```json
{
  "servers": {
    "testcase-knowledge-java": {
      "type": "stdio",
      "command": "java",
      "args": [
        "-jar",
        "${workspaceFolder}/target/testcase-knowledge-java-1.0.0.jar"
      ],
      "env": {
        "TESTCASE_INPUT_DIR": "${workspaceFolder}/input",
        "KNOWLEDGE_OUTPUT_DIR": "${workspaceFolder}/output"
      }
    }
  }
}
```

`.github/agents/testcase-knowledge-java.agent.md` with this front matter and body:

- `name`: `testcase-knowledge-java`
- `description`: `Read Excel test cases and write a product knowledge induction document for newly onboarded readers. Use when the user asks to generate product knowledge from the Java MCP server.`
- `tools`: `testcase-knowledge-java/list_testcases`, `testcase-knowledge-java/generate_knowledge_document`, `testcase-knowledge-java/list_output_documents`

Body: the agent converts `.xls` and `.xlsx` into one induction document. It does not invent product behavior and does not edit or delete source workbooks. CSV is not valid input. When asked to generate: call `list_testcases` (pass `inputFolder` only if the user named a folder); if zero test cases, stop and report skipped files; otherwise call `generate_knowledge_document` (omit folders unless named); reply with the output path, test-case count, product-area count, and skipped files or warnings. Say the document is the induction guide for a newly onboarded reader. Use only tool results. The server writes the `.docx`.

`src/main/resources/log4j2.xml`: status `ERROR`, one Console appender named `Stderr` targeting `SYSTEM_ERR`, pattern `[testcase-knowledge-java] %p %c{1} - %m%n`, root level `warn`.

`README.md` covering: purpose, the five-step Copilot flow, stdout versus stderr, `mvn test package`, `java -jar target/testcase-knowledge-java-1.0.0.jar --generate`, the Excel acceptance table, the induction document outline (cover, how to use, product map, each area), and Copilot setup ending with the prompt `Generate the product knowledge induction document from the Excel test cases`.

## Package `com.mcptool.knowledge`

All classes are `final` except the records. Utility classes have a private constructor. Records:

```java
public record TestCase(
        String sourceFile, String sheet, String id, String module, String feature,
        String title, String description, String preconditions, String steps,
        String expectedResult, String priority, String type) {}

public record FolderScan(
        String inputFolder, List<String> excelFiles, int sheetCount,
        int testCaseCount, List<String> skippedFiles, List<String> warnings) {}

public record GenerateResult(
        String outputFile, int testCaseCount, int moduleCount,
        List<String> skippedFiles, List<String> warnings) {}
```

### KnowledgeService

Static methods only.

- `inputFolder(requested)` / `outputFolder(requested)`: non-blank argument, else env `TESTCASE_INPUT_DIR` or `KNOWLEDGE_OUTPUT_DIR`, else `<user.dir>/input` or `<user.dir>/output`. Return absolute normalized paths.
- `scan(requestedInput)`: require the input directory (`Input folder does not exist: ...`), then `ExcelFolder.scan`.
- `generate(requestedInput, requestedOutput)`: require input, create output directories, `ExcelFolder.readAll`. If `cases` is empty, throw `IllegalArgumentException` with `No Excel test cases were found in ` + absolute input + `. Add .xls or .xlsx workbooks with a header row. CSV files are not accepted.` Otherwise write with `KnowledgeDocumentWriter.write` and return `GenerateResult` using the absolute output path, case count, `groupByModule(cases).size()`, skipped files, and warnings.
- `listDocuments(requestedOutput)`: if the folder is not a directory, return an empty list. Otherwise list `*.docx` (case-insensitive), sort by file name, return absolute paths.
- Missing input directory throws `IllegalArgumentException`.

### ExcelFolder

`MAX_FILE_BYTES` = 20 MB. Search the first 10 rows for a header.

`scan(inputFolder)` calls `readAll` and returns `FolderScan` with the absolute input path, Excel names, sheet count, case count, skipped files, and warnings.

`readAll` walks every regular file except `.gitkeep`, sorted by relative path. Relative names use `/`.

`rejectionReason(file)`:

- name starts with `~$` → `Excel lock file, ignored.`
- ends with `.xls` or `.xlsx` → `null` (accepted)
- ends with `.csv` → `CSV is not accepted. Save the sheet as .xls or .xlsx.`
- anything else, including `.xlsm` and `.xlsb` → `Only .xls and .xlsx workbooks are accepted.`

Rejected files go to `skippedFiles` as `relative — reason` and are not opened. Accepted files larger than 20 MB get a warning `relative was skipped because it is larger than 20 MB.` and are not added to the Excel name list. Other accepted files are added to the Excel name list, then opened with `WorkbookFactory` and a `DataFormatter` plus formula evaluator.

Per sheet: hidden or very hidden → warning `relative sheet 'name' is hidden and was skipped.` A sheet counts only when it contributes at least one `TestCase`. If the workbook has sheets but none contributed rows → warning `relative has no readable test-case rows.` `EncryptedDocumentException` → `relative is password-protected and was skipped.` Any other `IOException` or `RuntimeException` → `relative could not be read as an Excel workbook and was skipped.` Failures return 0 sheets and do not abort the batch.

Header row: first of the first 10 rows whose mapped headers contain `id` or `title`. Otherwise warning `relative sheet 'name' has no Test Case ID or Title column, so it was skipped.`

`canonical(header)` lowercases and strips non-alphanumeric characters, then maps:

- `testcaseid`, `tcid`, `id`, `testcaseno` → `id`
- `module`, `area`, `component` → `module`
- `feature`, `function` → `feature`
- `title`, `summary`, `testcasename`, `name` → `title`
- `description`, `objective` → `description`
- `preconditions`, `precondition`, `prerequisites` → `preconditions`
- `steps`, `teststeps`, `procedure` → `steps`
- `expectedresult`, `expected`, `expectedoutcome` → `expected`
- `priority` → `priority`
- `type`, `testtype`, `category` → `type`
- else `null`

First occurrence of a canonical name wins. A data row is skipped when both id and title are blank. Blank id → `ROW-` + 1-based Excel row number. Blank module → `General`. Blank title → the id. Cell text is `formatter.formatCellValue(cell, evaluator).trim()`.

Public nested record `ReadBatch(List<String> excelFiles, int sheetCount, List<TestCase> cases, List<String> skippedFiles)`.

### KnowledgeDocumentWriter

`write(outputFolder, cases)` creates the folder and writes `ProductKnowledgeInduction_yyyyMMdd.docx` using `DateTimeFormatter.BASIC_ISO_DATE`. If the file exists, append `_2`, `_3`, and so on. Return the path.

Page margins are 1080 twips on all sides (`CTPageMar`). Letter content width is 12240 minus margins. Font is Calibri. Colors: navy `1F4E79`, ink `222222`, muted `5B6770`, header fill `1F4E79` with white text, band fill `F3F6F9`. Tables use fixed layout (`STTblLayoutType.FIXED`), a `tblGrid` with the given column widths, and per-cell `tcW` in DXA. Header rows repeat. Body cells are left-aligned, vertically centered. Multi-line cell text uses run breaks. Alternate body rows use white and `F3F6F9`.

Sections in order:

1. Cover. Centered 28 pt bold navy `Product Knowledge Induction`. Centered 16 pt muted `For newly onboarded team members`. Then 12 pt ink: `This document explains the product from the master test cases. It covers N scenario(s) in M product area(s). Read it before you change or test a feature, so you know what the product is expected to do.` Pluralize scenario and area.
2. Heading `How to use this guide` plus four bullets: start with the product map and the scenarios a new joiner should learn first; open the area you will work in and read what it does, what must already be true, and the step-by-step behavior; the last table in each area lists situations the product must stop, used when reviewing a change; sentences come from the Excel test cases, and empty workbook fields are left out.
3. Heading `Product map` and the sentence `Learn the high-priority scenarios in each area before you pick up work there.` Table columns `Product area` 1800, `What it covers` 4200, `Learn these first` 4000. What it covers joins unique features with `, `, or an em dash `—` when blank. Learn these first is up to three titles whose priority lower-case contains `high`; if none, the first three titles, joined by `; `.
4. One heading per module in first-seen order. Opening paragraph is `module — ` plus unique descriptions joined by a space. If no descriptions, `module covers: ` plus unique titles joined by `; ` plus a period. Then optional `Before you start` bullets of unique preconditions. Split cases with `isGuard`. Non-guards under `How this area works`. Guards under `What the product must stop` with the sentence `A newly onboarded person should know these cases. The product is expected to refuse them.` and a table `ID` 1100, `Situation` 2200, `What you do` 3400, `What should happen` 3300. Situation is title, then a newline and description when description is non-blank.

Scenario block: bold navy `id  title` and, when priority is non-blank, `  (priority)`. Then description if present. If steps are present, muted bold `Do this` and one bullet per non-blank line of `split("\\R")`. If expected result is present: `You should see: ` plus that text. Omit blank fields.

`isGuard`: type lower-case contains `negative`, `boundary`, `invalid`, or `error`.

`groupByModule` returns a `LinkedHashMap` keyed by module in encounter order. Headings are 18 pt bold navy. Subheadings are 14 pt bold navy. Bullets use `•  ` with a 360 twip left indent.

### KnowledgeServer

`main`: if `args[0]` is `--generate`, call `KnowledgeService.generate(null, null)` and print:

```text
Wrote <path>
Test cases: <n>
Product areas: <m>
```

Otherwise start an MCP sync server on `StdioServerTransportProvider` with `McpJsonDefaults.getMapper()`. Server info `testcase-knowledge-java` version `1.0.0`. Capabilities: tools only. Register three `toolCall`s. Log `MCP server ready on stdio` to stderr. Add a shutdown hook that closes the server. Join the current thread.

Tools, all additionalProperties false:

- `list_testcases` — `List .xls and .xlsx test-case workbooks and count rows. CSV files are reported as skipped.` Schema property `inputFolder`: `Folder of .xls and .xlsx test cases. Omit to use TESTCASE_INPUT_DIR or ./input.`
- `generate_knowledge_document` — `Read Excel test cases and write a product-knowledge induction document for newly onboarded readers.` Properties `inputFolder` (same description) and `outputFolder`: `Folder for the induction Word file. Omit to use KNOWLEDGE_OUTPUT_DIR or ./output.`
- `list_output_documents` — `List induction Word documents already written in the output folder.` Property `outputFolder` only.

Blank or missing arguments become null. Success text:

- list: `Input folder`, `Excel files`, `Sheets with test cases`, `Test cases`, then `Files:` bullets, then `Skipped:` and `Warnings:` bullets when non-empty.
- generate: `Wrote induction document <path>`, `Test cases`, `Product areas`, then skipped and warnings. Also log `Wrote <path>` to stderr. On failure log `Generate failed: <message>`.
- documents: joined absolute paths, or `No Word documents are in the output folder yet.`

Errors return `CallToolResult` with `isError` true and `exception.getMessage()`, or `toString()` when the message is null. Stderr lines use `[testcase-knowledge-java] `.

Build tools with `Tool.builder(name, schema).description(description).build()`. Text content uses `TextContent.builder(message).build()`.

### SampleWorkbook

`main` creates `input/payments.xlsx` (XSSF), sheet `Master`, header row:

`Test Case ID, Module, Feature, Title, Description, Preconditions, Steps, Expected Result, Priority, Type`

Rows:

- TC-100, Checkout, Place order, Place order, `Customer places an order from the cart.`, `Customer is signed in and the cart has one item.`, steps `1. Open the catalog` / `2. Add the selected item to the cart` / `3. Submit the order` (newline-separated), `The order confirmation number is shown.`, High, Functional
- TC-101, Checkout, Place order, Apply coupon, `A valid coupon reduces the cart total.`, `A coupon is available.`, `1. Open the cart` / `2. Enter the coupon code` / `3. Apply the coupon code`, `The discounted total is shown.`, Medium, Functional
- TC-300, Payments, Card payment, Pay by card, `A valid card completes payment.`, `The customer is on the payment step.`, `1. Enter the card` / `2. Confirm the payment`, `The payment receipt is shown.`, High, Functional
- TC-301, Payments, Card payment, Reject an expired card, `An expired card must not take payment.`, `The customer is on the payment step.`, `1. Enter an expired card` / `2. Confirm the payment`, `The payment is declined and the cart is unchanged.`, High, Negative

Print `Wrote ` plus the absolute normalized path.

### CSV leftovers

Include these two classes so the tree matches the project, but do not call them from `KnowledgeService` or the server. CSV input stays rejected by `ExcelFolder`.

`CsvTable`: `parse(String)` returns rows. Strip a leading UTF-8 BOM. Detect delimiter from the first line outside quotes: `;` when semicolons outnumber commas, otherwise `,`. Honor quotes, doubled quotes as one quote, and newlines inside quotes. Trim cells. Drop fully blank rows. Ignore bare `\r`.

`TestCaseFolder`: same canonical header map as `ExcelFolder`. `MAX_FILE_BYTES` = 5 MB. `scan`, `readAll`, and `skippedNames` walk the tree. CSV files are the readable set. Every other regular file except `.gitkeep` is skipped (names only, no reason suffix). Oversize warning: `relative was skipped because it is larger than 5 MB.` Empty file: `relative has no rows.` Missing id and title headers: `relative has no Test Case ID or Title column, so its rows were skipped.` Blank id → `ROW-` + data-row index (first data row is 1). Blank module → `General`. Blank title → id. Sheet name is `""`. `FolderScan.sheetCount` is 0. Read files as UTF-8 via `CsvTable.parse`.

### Tests

`KnowledgePipelineTest` with `@TempDir Path temp`:

1. `xlsxBecomesAnInductionDocument` — write `payments.xlsx` with TC-100 Checkout Functional High, TC-101 Checkout Functional Medium, TC-301 Payments Negative High (same text as the test fixture: place order, apply coupon, reject expired card). `ExcelFolder.scan` finds 1 file and 3 cases. `KnowledgeService.generate` returns 2 modules, a path containing `ProductKnowledgeInduction_`, and a file larger than 1000 bytes.
2. `xlsIsAcceptedAndCsvIsRejected` — write `legacy.xls` (HSSF) with the same three rows and `notes.csv` containing `id,title\n1,Nope\n`. Scan finds 1 Excel file, 3 cases, and a skipped entry containing `CSV is not accepted`. `ExcelFolder.rejectionReason` on the `.xls` is null. `ExcelFolder.canonical("Test Case ID")` equals `id`.
3. `folderWithOnlyCsvFailsValidation` — only `cases.csv` with `Title\nPlace order\n`. `generate` throws `IllegalArgumentException` whose message contains `.xls or .xlsx`.

## Done when

`mvn test package` succeeds and produces `target/testcase-knowledge-java-1.0.0.jar`. `java -jar target/testcase-knowledge-java-1.0.0.jar --generate` writes a `.docx` when `input/` contains at least one valid workbook.
