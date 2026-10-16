package com.mcptool.knowledge;

import org.apache.poi.EncryptedDocumentException;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.DataFormatter;
import org.apache.poi.ss.usermodel.FormulaEvaluator;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.ss.usermodel.WorkbookFactory;

import java.io.IOException;
import java.io.InputStream;
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
 * Reads .xls and .xlsx test-case workbooks. Source files are never modified.
 * CSV and any other type are reported as skipped.
 */
public final class ExcelFolder {

    static final long MAX_FILE_BYTES = 20L * 1024L * 1024L;
    private static final int HEADER_SEARCH_ROWS = 10;

    private ExcelFolder() {
    }

    public static FolderScan scan(Path inputFolder) throws IOException {
        List<String> warnings = new ArrayList<>();
        ReadBatch batch = readAll(inputFolder, warnings);
        return new FolderScan(
                inputFolder.toAbsolutePath().normalize().toString(),
                batch.excelFiles(),
                batch.sheetCount(),
                batch.cases().size(),
                batch.skippedFiles(),
                warnings);
    }

    public static ReadBatch readAll(Path inputFolder, List<String> warnings) throws IOException {
        List<Path> files = listFiles(inputFolder);
        List<String> excelNames = new ArrayList<>();
        List<String> skipped = new ArrayList<>();
        List<TestCase> cases = new ArrayList<>();
        int sheets = 0;

        for (Path file : files) {
            String relative = relativeName(inputFolder, file);
            String rejection = rejectionReason(file);
            if (rejection != null) {
                skipped.add(relative + " — " + rejection);
                continue;
            }
            long size = Files.size(file);
            if (size > MAX_FILE_BYTES) {
                warnings.add(relative + " was skipped because it is larger than 20 MB.");
                continue;
            }
            excelNames.add(relative);
            sheets += readWorkbook(file, relative, cases, warnings);
        }
        return new ReadBatch(excelNames, sheets, cases, skipped);
    }

    static String rejectionReason(Path file) {
        String name = file.getFileName().toString();
        String lower = name.toLowerCase(Locale.ROOT);
        if (lower.startsWith("~$")) {
            return "Excel lock file, ignored.";
        }
        if (lower.endsWith(".xls") || lower.endsWith(".xlsx")) {
            return null;
        }
        if (lower.endsWith(".csv")) {
            return "CSV is not accepted. Save the sheet as .xls or .xlsx.";
        }
        if (lower.endsWith(".xlsm") || lower.endsWith(".xlsb")) {
            return "Only .xls and .xlsx workbooks are accepted.";
        }
        return "Only .xls and .xlsx workbooks are accepted.";
    }

    private static int readWorkbook(Path file, String relative, List<TestCase> cases, List<String> warnings) {
        try (InputStream in = Files.newInputStream(file);
             Workbook workbook = WorkbookFactory.create(in)) {
            DataFormatter formatter = new DataFormatter();
            FormulaEvaluator evaluator = workbook.getCreationHelper().createFormulaEvaluator();
            int usedSheets = 0;
            for (int index = 0; index < workbook.getNumberOfSheets(); index++) {
                if (workbook.isSheetHidden(index) || workbook.isSheetVeryHidden(index)) {
                    warnings.add(relative + " sheet '" + workbook.getSheetName(index) + "' is hidden and was skipped.");
                    continue;
                }
                Sheet sheet = workbook.getSheetAt(index);
                int before = cases.size();
                readSheet(sheet, relative, formatter, evaluator, cases, warnings);
                if (cases.size() > before) {
                    usedSheets++;
                }
            }
            if (usedSheets == 0 && workbook.getNumberOfSheets() > 0) {
                warnings.add(relative + " has no readable test-case rows.");
            }
            return usedSheets;
        } catch (EncryptedDocumentException ex) {
            warnings.add(relative + " is password-protected and was skipped.");
            return 0;
        } catch (IOException | RuntimeException ex) {
            warnings.add(relative + " could not be read as an Excel workbook and was skipped.");
            return 0;
        }
    }

    private static void readSheet(
            Sheet sheet,
            String relative,
            DataFormatter formatter,
            FormulaEvaluator evaluator,
            List<TestCase> cases,
            List<String> warnings) {
        int headerRow = findHeaderRow(sheet, formatter, evaluator);
        if (headerRow < 0) {
            warnings.add(relative + " sheet '" + sheet.getSheetName()
                    + "' has no Test Case ID or Title column, so it was skipped.");
            return;
        }
        Map<String, Integer> columns = mapHeaders(sheet.getRow(headerRow), formatter, evaluator);
        for (int rowIndex = headerRow + 1; rowIndex <= sheet.getLastRowNum(); rowIndex++) {
            Row row = sheet.getRow(rowIndex);
            if (row == null) {
                continue;
            }
            String title = cell(row, columns, "title", formatter, evaluator);
            String id = cell(row, columns, "id", formatter, evaluator);
            if (title.isBlank() && id.isBlank()) {
                continue;
            }
            String module = cell(row, columns, "module", formatter, evaluator);
            cases.add(new TestCase(
                    relative,
                    sheet.getSheetName(),
                    id.isBlank() ? "ROW-" + (rowIndex + 1) : id,
                    module.isBlank() ? "General" : module,
                    cell(row, columns, "feature", formatter, evaluator),
                    title.isBlank() ? id : title,
                    cell(row, columns, "description", formatter, evaluator),
                    cell(row, columns, "preconditions", formatter, evaluator),
                    cell(row, columns, "steps", formatter, evaluator),
                    cell(row, columns, "expected", formatter, evaluator),
                    cell(row, columns, "priority", formatter, evaluator),
                    cell(row, columns, "type", formatter, evaluator)));
        }
    }

    private static int findHeaderRow(Sheet sheet, DataFormatter formatter, FormulaEvaluator evaluator) {
        int last = Math.min(sheet.getLastRowNum(), HEADER_SEARCH_ROWS - 1);
        for (int rowIndex = 0; rowIndex <= last; rowIndex++) {
            Row row = sheet.getRow(rowIndex);
            if (row == null) {
                continue;
            }
            Map<String, Integer> columns = mapHeaders(row, formatter, evaluator);
            if (columns.containsKey("id") || columns.containsKey("title")) {
                return rowIndex;
            }
        }
        return -1;
    }

    private static Map<String, Integer> mapHeaders(Row row, DataFormatter formatter, FormulaEvaluator evaluator) {
        Map<String, Integer> columns = new LinkedHashMap<>();
        if (row == null) {
            return columns;
        }
        for (int index = 0; index < row.getLastCellNum(); index++) {
            String key = canonical(text(row.getCell(index), formatter, evaluator));
            if (key != null && !columns.containsKey(key)) {
                columns.put(key, index);
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

    private static String cell(
            Row row,
            Map<String, Integer> columns,
            String key,
            DataFormatter formatter,
            FormulaEvaluator evaluator) {
        Integer index = columns.get(key);
        if (index == null) {
            return "";
        }
        return text(row.getCell(index), formatter, evaluator);
    }

    private static String text(Cell cell, DataFormatter formatter, FormulaEvaluator evaluator) {
        if (cell == null) {
            return "";
        }
        return formatter.formatCellValue(cell, evaluator).trim();
    }

    private static List<Path> listFiles(Path inputFolder) throws IOException {
        try (Stream<Path> walk = Files.walk(inputFolder)) {
            return walk.filter(Files::isRegularFile)
                    .filter(path -> !path.getFileName().toString().equals(".gitkeep"))
                    .sorted(Comparator.comparing(path -> inputFolder.relativize(path).toString()))
                    .toList();
        }
    }

    private static String relativeName(Path root, Path file) {
        return root.relativize(file).toString().replace('\\', '/');
    }

    public record ReadBatch(
            List<String> excelFiles,
            int sheetCount,
            List<TestCase> cases,
            List<String> skippedFiles) {
    }
}
