package com.mcptool.knowledge;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Stream;

/**
 * Reads every .csv file under the input folder. Source files are never modified.
 */
public final class TestCaseFolder {

    static final long MAX_FILE_BYTES = 5L * 1024L * 1024L;

    private TestCaseFolder() {
    }

    public static FolderScan scan(Path inputFolder) throws IOException {
        List<Path> csvFiles = listCsvFiles(inputFolder);
        List<String> skipped = listSkipped(inputFolder);
        List<String> warnings = new ArrayList<>();
        int count = 0;
        for (Path file : csvFiles) {
            count += readFile(inputFolder, file, warnings).size();
        }
        return new FolderScan(
                inputFolder.toAbsolutePath().normalize().toString(),
                names(inputFolder, csvFiles),
                0,
                count,
                skipped,
                warnings);
    }

    public static List<TestCase> readAll(Path inputFolder, List<String> warnings) throws IOException {
        List<TestCase> cases = new ArrayList<>();
        for (Path file : listCsvFiles(inputFolder)) {
            cases.addAll(readFile(inputFolder, file, warnings));
        }
        return cases;
    }

    public static List<String> skippedNames(Path inputFolder) throws IOException {
        return listSkipped(inputFolder);
    }

    private static List<TestCase> readFile(Path inputFolder, Path file, List<String> warnings) throws IOException {
        long size = Files.size(file);
        String relative = inputFolder.relativize(file).toString().replace('\\', '/');
        if (size > MAX_FILE_BYTES) {
            warnings.add(relative + " was skipped because it is larger than 5 MB.");
            return List.of();
        }
        List<List<String>> rows = CsvTable.parse(Files.readString(file, StandardCharsets.UTF_8));
        if (rows.isEmpty()) {
            warnings.add(relative + " has no rows.");
            return List.of();
        }
        Map<String, Integer> columns = mapHeaders(rows.get(0));
        if (!columns.containsKey("title") && !columns.containsKey("id")) {
            warnings.add(relative + " has no Test Case ID or Title column, so its rows were skipped.");
            return List.of();
        }
        List<TestCase> cases = new ArrayList<>();
        for (int i = 1; i < rows.size(); i++) {
            List<String> row = rows.get(i);
            String title = cell(row, columns, "title");
            String id = cell(row, columns, "id");
            if (title.isBlank() && id.isBlank()) {
                continue;
            }
            String module = cell(row, columns, "module");
            cases.add(new TestCase(
                    relative,
                    "",
                    id.isBlank() ? "ROW-" + i : id,
                    module.isBlank() ? "General" : module,
                    cell(row, columns, "feature"),
                    title.isBlank() ? id : title,
                    cell(row, columns, "description"),
                    cell(row, columns, "preconditions"),
                    cell(row, columns, "steps"),
                    cell(row, columns, "expected"),
                    cell(row, columns, "priority"),
                    cell(row, columns, "type")));
        }
        return cases;
    }

    private static Map<String, Integer> mapHeaders(List<String> headers) {
        Map<String, Integer> columns = new LinkedHashMap<>();
        for (int i = 0; i < headers.size(); i++) {
            String key = canonical(headers.get(i));
            if (key != null && !columns.containsKey(key)) {
                columns.put(key, i);
            }
        }
        return columns;
    }

    /** Turns common header spellings into the few names the rest of the program uses. */
    static String canonical(String header) {
        String normalized = header == null ? "" : header.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
        return switch (normalized) {
            case "testcaseid", "tcid", "id", "testcaseno" -> "id";
            case "module", "area", "component" -> "module";
            case "feature", "function" -> "feature";
            case "title", "summary", "testcasename", "name" -> "title";
            case "description", "objective" -> "description";
            case "preconditions", "precondition", "prerequisites" -> "preconditions";
            case "steps", "teststeps", "procedure" -> "steps";
            case "expectedresult", "expected", "expectedoutcome" -> "expected";
            case "priority" -> "priority";
            case "type", "testtype", "category" -> "type";
            default -> null;
        };
    }

    private static String cell(List<String> row, Map<String, Integer> columns, String key) {
        Integer index = columns.get(key);
        if (index == null || index >= row.size()) {
            return "";
        }
        return row.get(index);
    }

    private static List<Path> listCsvFiles(Path inputFolder) throws IOException {
        try (Stream<Path> walk = Files.walk(inputFolder)) {
            return walk.filter(Files::isRegularFile)
                    .filter(path -> path.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".csv"))
                    .sorted(Comparator.comparing(path -> inputFolder.relativize(path).toString()))
                    .toList();
        }
    }

    private static List<String> listSkipped(Path inputFolder) throws IOException {
        try (Stream<Path> walk = Files.walk(inputFolder)) {
            return walk.filter(Files::isRegularFile)
                    .filter(path -> !path.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".csv"))
                    .filter(path -> !path.getFileName().toString().equals(".gitkeep"))
                    .map(path -> inputFolder.relativize(path).toString().replace('\\', '/'))
                    .sorted()
                    .toList();
        }
    }

    private static List<String> names(Path inputFolder, List<Path> files) {
        List<String> names = new ArrayList<>();
        for (Path file : files) {
            names.add(inputFolder.relativize(file).toString().replace('\\', '/'));
        }
        return names;
    }
}
