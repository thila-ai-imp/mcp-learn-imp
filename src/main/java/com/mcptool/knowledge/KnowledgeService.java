package com.mcptool.knowledge;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Stream;

/**
 * Business flow, separate from the MCP protocol.
 * 1. Check the folders.
 * 2. Read .xls and .xlsx test cases.
 * 3. Write the induction document.
 */
public final class KnowledgeService {

    private KnowledgeService() {
    }

    public static Path inputFolder(String requested) {
        return folder(requested, "TESTCASE_INPUT_DIR", "input");
    }

    public static Path outputFolder(String requested) {
        return folder(requested, "KNOWLEDGE_OUTPUT_DIR", "output");
    }

    public static FolderScan scan(String requestedInput) throws IOException {
        Path input = requireDirectory(inputFolder(requestedInput), "Input folder");
        return ExcelFolder.scan(input);
    }

    public static GenerateResult generate(String requestedInput, String requestedOutput) throws IOException {
        Path input = requireDirectory(inputFolder(requestedInput), "Input folder");
        Path output = outputFolder(requestedOutput);
        Files.createDirectories(output);

        List<String> warnings = new ArrayList<>();
        ExcelFolder.ReadBatch batch = ExcelFolder.readAll(input, warnings);
        if (batch.cases().isEmpty()) {
            throw new IllegalArgumentException(
                    "No Excel test cases were found in " + input.toAbsolutePath().normalize()
                            + ". Add .xls or .xlsx workbooks with a header row. CSV files are not accepted.");
        }
        Path written = KnowledgeDocumentWriter.write(output, batch.cases());
        return new GenerateResult(
                written.toAbsolutePath().normalize().toString(),
                batch.cases().size(),
                KnowledgeDocumentWriter.groupByModule(batch.cases()).size(),
                batch.skippedFiles(),
                warnings);
    }

    public static List<String> listDocuments(String requestedOutput) throws IOException {
        Path output = outputFolder(requestedOutput);
        if (!Files.isDirectory(output)) {
            return List.of();
        }
        try (Stream<Path> files = Files.list(output)) {
            return files.filter(path -> path.getFileName().toString().toLowerCase().endsWith(".docx"))
                    .sorted(Comparator.comparing(path -> path.getFileName().toString()))
                    .map(path -> path.toAbsolutePath().normalize().toString())
                    .toList();
        }
    }

    private static Path folder(String requested, String envName, String fallback) {
        if (requested != null && !requested.isBlank()) {
            return Path.of(requested.trim()).toAbsolutePath().normalize();
        }
        String fromEnv = System.getenv(envName);
        if (fromEnv != null && !fromEnv.isBlank()) {
            return Path.of(fromEnv.trim()).toAbsolutePath().normalize();
        }
        return Path.of(System.getProperty("user.dir")).resolve(fallback).toAbsolutePath().normalize();
    }

    private static Path requireDirectory(Path path, String label) {
        if (!Files.isDirectory(path)) {
            throw new IllegalArgumentException(label + " does not exist: " + path);
        }
        return path;
    }
}
