package com.mcptool.knowledge;

import io.modelcontextprotocol.json.McpJsonDefaults;
import io.modelcontextprotocol.server.McpServer;
import io.modelcontextprotocol.server.McpSyncServer;
import io.modelcontextprotocol.server.McpSyncServerExchange;
import io.modelcontextprotocol.server.transport.StdioServerTransportProvider;
import io.modelcontextprotocol.spec.McpSchema.CallToolRequest;
import io.modelcontextprotocol.spec.McpSchema.CallToolResult;
import io.modelcontextprotocol.spec.McpSchema.ServerCapabilities;
import io.modelcontextprotocol.spec.McpSchema.TextContent;
import io.modelcontextprotocol.spec.McpSchema.Tool;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * MCP entry point. Copilot starts this process and talks JSON-RPC on stdin/stdout.
 * Logs stay on stderr so they never break the protocol.
 *
 * Local check without Copilot:
 *   java -jar target/testcase-knowledge-java-1.0.0.jar --generate
 */
public final class KnowledgeServer {

    private KnowledgeServer() {
    }

    public static void main(String[] args) throws Exception {
        if (args.length > 0 && "--generate".equals(args[0])) {
            GenerateResult result = KnowledgeService.generate(null, null);
            System.out.println("Wrote " + result.outputFile());
            System.out.println("Test cases: " + result.testCaseCount());
            System.out.println("Product areas: " + result.moduleCount());
            return;
        }
        startMcpServer();
    }

    private static void startMcpServer() throws InterruptedException {
        StdioServerTransportProvider transport =
                new StdioServerTransportProvider(McpJsonDefaults.getMapper());

        McpSyncServer server = McpServer.sync(transport)
                .serverInfo("testcase-knowledge-java", "1.0.0")
                .capabilities(ServerCapabilities.builder().tools(true).build())
                .toolCall(tool(
                        "list_testcases",
                        "List .xls and .xlsx test-case workbooks and count rows. CSV files are reported as skipped.",
                        inputOnlySchema()), KnowledgeServer::listTestCases)
                .toolCall(tool(
                        "generate_knowledge_document",
                        "Read Excel test cases and write a product-knowledge induction document for newly onboarded readers.",
                        bothFoldersSchema()), KnowledgeServer::generateDocument)
                .toolCall(tool(
                        "list_output_documents",
                        "List induction Word documents already written in the output folder.",
                        outputOnlySchema()), KnowledgeServer::listDocuments)
                .build();

        log("MCP server ready on stdio");
        Runtime.getRuntime().addShutdownHook(new Thread(server::close));
        Thread.currentThread().join();
    }

    private static CallToolResult listTestCases(McpSyncServerExchange exchange, CallToolRequest request) {
        try {
            FolderScan scan = KnowledgeService.scan(text(request, "inputFolder"));
            StringBuilder text = new StringBuilder();
            text.append("Input folder: ").append(scan.inputFolder()).append('\n');
            text.append("Excel files: ").append(scan.excelFiles().size()).append('\n');
            text.append("Sheets with test cases: ").append(scan.sheetCount()).append('\n');
            text.append("Test cases: ").append(scan.testCaseCount()).append('\n');
            if (!scan.excelFiles().isEmpty()) {
                text.append("Files:\n");
                for (String file : scan.excelFiles()) {
                    text.append("- ").append(file).append('\n');
                }
            }
            appendNotes(text, "Skipped", scan.skippedFiles());
            appendNotes(text, "Warnings", scan.warnings());
            return ok(text.toString().trim());
        } catch (RuntimeException | java.io.IOException ex) {
            return error(ex);
        }
    }

    private static CallToolResult generateDocument(McpSyncServerExchange exchange, CallToolRequest request) {
        try {
            GenerateResult result = KnowledgeService.generate(
                    text(request, "inputFolder"),
                    text(request, "outputFolder"));
            StringBuilder text = new StringBuilder();
            text.append("Wrote induction document ").append(result.outputFile()).append('\n');
            text.append("Test cases: ").append(result.testCaseCount()).append('\n');
            text.append("Product areas: ").append(result.moduleCount()).append('\n');
            appendNotes(text, "Skipped", result.skippedFiles());
            appendNotes(text, "Warnings", result.warnings());
            log("Wrote " + result.outputFile());
            return ok(text.toString().trim());
        } catch (RuntimeException | java.io.IOException ex) {
            log("Generate failed: " + ex.getMessage());
            return error(ex);
        }
    }

    private static CallToolResult listDocuments(McpSyncServerExchange exchange, CallToolRequest request) {
        try {
            List<String> documents = KnowledgeService.listDocuments(text(request, "outputFolder"));
            if (documents.isEmpty()) {
                return ok("No Word documents are in the output folder yet.");
            }
            return ok(String.join("\n", documents));
        } catch (RuntimeException | java.io.IOException ex) {
            return error(ex);
        }
    }

    private static Tool tool(String name, String description, Map<String, Object> schema) {
        return Tool.builder(name, schema).description(description).build();
    }

    private static Map<String, Object> inputOnlySchema() {
        return schema(true, false);
    }

    private static Map<String, Object> outputOnlySchema() {
        return schema(false, true);
    }

    private static Map<String, Object> bothFoldersSchema() {
        return schema(true, true);
    }

    private static Map<String, Object> schema(boolean input, boolean output) {
        Map<String, Object> properties = new LinkedHashMap<>();
        if (input) {
            properties.put("inputFolder", Map.of(
                    "type", "string",
                    "description", "Folder of .xls and .xlsx test cases. Omit to use TESTCASE_INPUT_DIR or ./input."));
        }
        if (output) {
            properties.put("outputFolder", Map.of(
                    "type", "string",
                    "description", "Folder for the induction Word file. Omit to use KNOWLEDGE_OUTPUT_DIR or ./output."));
        }
        return Map.of(
                "type", "object",
                "properties", properties,
                "additionalProperties", false);
    }

    private static String text(CallToolRequest request, String name) {
        if (request.arguments() == null || request.arguments().get(name) == null) {
            return null;
        }
        String value = String.valueOf(request.arguments().get(name)).trim();
        return value.isEmpty() ? null : value;
    }

    private static void appendNotes(StringBuilder text, String label, List<String> notes) {
        if (notes == null || notes.isEmpty()) {
            return;
        }
        text.append(label).append(":\n");
        for (String note : notes) {
            text.append("- ").append(note).append('\n');
        }
    }

    private static CallToolResult ok(String message) {
        return CallToolResult.builder()
                .content(List.of(TextContent.builder(message).build()))
                .isError(false)
                .build();
    }

    private static CallToolResult error(Exception ex) {
        String message = ex.getMessage() == null ? ex.toString() : ex.getMessage();
        return CallToolResult.builder()
                .content(List.of(TextContent.builder(message).build()))
                .isError(true)
                .build();
    }

    private static void log(String message) {
        System.err.println("[testcase-knowledge-java] " + message);
    }
}
