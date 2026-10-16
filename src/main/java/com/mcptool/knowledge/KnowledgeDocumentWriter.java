package com.mcptool.knowledge;

import org.apache.poi.xwpf.usermodel.ParagraphAlignment;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.apache.poi.xwpf.usermodel.XWPFParagraph;
import org.apache.poi.xwpf.usermodel.XWPFRun;
import org.apache.poi.xwpf.usermodel.XWPFTable;
import org.apache.poi.xwpf.usermodel.XWPFTableCell;
import org.apache.poi.xwpf.usermodel.XWPFTableRow;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.CTPageMar;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.CTSectPr;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.CTTblGrid;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.CTTblGridCol;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.CTTblLayoutType;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.CTTblPr;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.CTTblWidth;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.CTTcPr;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.STTblLayoutType;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.STTblWidth;

import java.io.IOException;
import java.io.OutputStream;
import java.math.BigInteger;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Writes a product-knowledge induction document for a newly onboarded reader.
 * Every statement comes from the Excel test cases.
 */
public final class KnowledgeDocumentWriter {

    private static final int PAGE_WIDTH = 12240;
    private static final int MARGIN = 1080;
    private static final int CONTENT_WIDTH = PAGE_WIDTH - (MARGIN * 2);
    private static final String NAVY = "1F4E79";
    private static final String INK = "222222";
    private static final String MUTED = "5B6770";
    private static final String HEADER_FILL = "1F4E79";
    private static final String BAND_FILL = "F3F6F9";

    private KnowledgeDocumentWriter() {
    }

    public static Path write(Path outputFolder, List<TestCase> cases) throws IOException {
        Files.createDirectories(outputFolder);
        String stamp = LocalDate.now().format(DateTimeFormatter.BASIC_ISO_DATE);
        Path outputFile = uniqueFile(outputFolder, "ProductKnowledgeInduction_" + stamp);

        try (XWPFDocument document = new XWPFDocument();
             OutputStream out = Files.newOutputStream(outputFile)) {
            setPage(document);
            writeCover(document, cases);
            writeHowToRead(document);
            writeProductMap(document, cases);
            for (Map.Entry<String, List<TestCase>> module : groupByModule(cases).entrySet()) {
                writeModule(document, module.getKey(), module.getValue());
            }
            document.write(out);
        }
        return outputFile;
    }

    private static Path uniqueFile(Path folder, String baseName) {
        Path candidate = folder.resolve(baseName + ".docx");
        int part = 2;
        while (Files.exists(candidate)) {
            candidate = folder.resolve(baseName + "_" + part + ".docx");
            part++;
        }
        return candidate;
    }

    private static void setPage(XWPFDocument document) {
        CTSectPr section = document.getDocument().getBody().isSetSectPr()
                ? document.getDocument().getBody().getSectPr()
                : document.getDocument().getBody().addNewSectPr();
        CTPageMar margins = section.isSetPgMar() ? section.getPgMar() : section.addNewPgMar();
        margins.setTop(BigInteger.valueOf(MARGIN));
        margins.setBottom(BigInteger.valueOf(MARGIN));
        margins.setLeft(BigInteger.valueOf(MARGIN));
        margins.setRight(BigInteger.valueOf(MARGIN));
    }

    private static void writeCover(XWPFDocument document, List<TestCase> cases) {
        paragraph(document, "Product Knowledge Induction", 28, true, NAVY, ParagraphAlignment.CENTER, 0, 160);
        paragraph(document, "For newly onboarded team members", 16, false, MUTED, ParagraphAlignment.CENTER, 0, 280);
        int modules = groupByModule(cases).size();
        paragraph(document,
                "This document explains the product from the master test cases. "
                        + "It covers " + cases.size() + " scenario"
                        + (cases.size() == 1 ? "" : "s")
                        + " in " + modules + " product area"
                        + (modules == 1 ? "" : "s")
                        + ". Read it before you change or test a feature, so you know what the product is expected to do.",
                12, false, INK, ParagraphAlignment.LEFT, 80, 200);
    }

    private static void writeHowToRead(XWPFDocument document) {
        heading(document, "How to use this guide");
        bullet(document, "Start with the product map. It shows each area and the scenarios a new joiner should learn first.");
        bullet(document, "Open the area you will work in. Read what it does, what must already be true, and the step-by-step behavior.");
        bullet(document, "The last table in each area lists situations the product must stop. Use those when you review a change.");
        bullet(document, "Sentences come from the Excel test cases. If a field was empty in the workbook, it is left out here.");
    }

    private static void writeProductMap(XWPFDocument document, List<TestCase> cases) {
        heading(document, "Product map");
        paragraph(document,
                "Learn the high-priority scenarios in each area before you pick up work there.",
                12, false, INK, ParagraphAlignment.LEFT, 0, 120);

        String[] headers = {"Product area", "What it covers", "Learn these first"};
        int[] widths = {1800, 4200, 4000};
        List<Map.Entry<String, List<TestCase>>> modules = new ArrayList<>(groupByModule(cases).entrySet());
        XWPFTable table = document.createTable(modules.size() + 1, headers.length);
        lockTable(table, widths);
        writeHeader(table.getRow(0), headers, widths);
        for (int index = 0; index < modules.size(); index++) {
            Map.Entry<String, List<TestCase>> module = modules.get(index);
            String fill = index % 2 == 0 ? "FFFFFF" : BAND_FILL;
            String[] values = {
                    module.getKey(),
                    joinUnique(module.getValue(), TestCase::feature, ", "),
                    learnFirst(module.getValue())
            };
            writeBodyRow(table.getRow(index + 1), values, widths, fill);
        }
    }

    private static void writeModule(XWPFDocument document, String module, List<TestCase> cases) {
        heading(document, module);
        paragraph(document, purpose(module, cases), 12, false, INK, ParagraphAlignment.LEFT, 40, 120);

        List<String> preconditions = unique(cases, TestCase::preconditions);
        if (!preconditions.isEmpty()) {
            subheading(document, "Before you start");
            for (String item : preconditions) {
                bullet(document, item);
            }
        }

        List<TestCase> happyPath = new ArrayList<>();
        List<TestCase> guards = new ArrayList<>();
        for (TestCase testCase : cases) {
            if (isGuard(testCase)) {
                guards.add(testCase);
            } else {
                happyPath.add(testCase);
            }
        }

        if (!happyPath.isEmpty()) {
            subheading(document, "How this area works");
            for (TestCase testCase : happyPath) {
                writeScenario(document, testCase);
            }
        }
        if (!guards.isEmpty()) {
            subheading(document, "What the product must stop");
            paragraph(document,
                    "A newly onboarded person should know these cases. The product is expected to refuse them.",
                    12, false, INK, ParagraphAlignment.LEFT, 0, 80);
            writeGuardTable(document, guards);
        }
    }

    private static void writeScenario(XWPFDocument document, TestCase testCase) {
        String label = testCase.id() + "  " + testCase.title();
        if (!testCase.priority().isBlank()) {
            label = label + "  (" + testCase.priority() + ")";
        }
        paragraph(document, label, 12, true, NAVY, ParagraphAlignment.LEFT, 140, 40);
        if (!testCase.description().isBlank()) {
            paragraph(document, testCase.description(), 12, false, INK, ParagraphAlignment.LEFT, 0, 40);
        }
        if (!testCase.steps().isBlank()) {
            paragraph(document, "Do this", 11, true, MUTED, ParagraphAlignment.LEFT, 40, 20);
            for (String step : testCase.steps().split("\\R")) {
                if (!step.isBlank()) {
                    bullet(document, step.trim());
                }
            }
        }
        if (!testCase.expectedResult().isBlank()) {
            paragraph(document, "You should see: " + testCase.expectedResult(),
                    12, false, INK, ParagraphAlignment.LEFT, 40, 40);
        }
    }

    private static void writeGuardTable(XWPFDocument document, List<TestCase> guards) {
        String[] headers = {"ID", "Situation", "What you do", "What should happen"};
        int[] widths = {1100, 2200, 3400, 3300};
        XWPFTable table = document.createTable(guards.size() + 1, headers.length);
        lockTable(table, widths);
        writeHeader(table.getRow(0), headers, widths);
        for (int index = 0; index < guards.size(); index++) {
            TestCase testCase = guards.get(index);
            String situation = testCase.title();
            if (!testCase.description().isBlank()) {
                situation = situation + "\n" + testCase.description();
            }
            String fill = index % 2 == 0 ? "FFFFFF" : BAND_FILL;
            writeBodyRow(table.getRow(index + 1), new String[] {
                    testCase.id(),
                    situation,
                    testCase.steps(),
                    testCase.expectedResult()
            }, widths, fill);
        }
    }

    private static String purpose(String module, List<TestCase> cases) {
        List<String> descriptions = unique(cases, TestCase::description);
        if (!descriptions.isEmpty()) {
            return module + " — " + String.join(" ", descriptions);
        }
        return module + " covers: " + joinUnique(cases, TestCase::title, "; ") + ".";
    }

    private static String learnFirst(List<TestCase> cases) {
        List<String> high = new ArrayList<>();
        for (TestCase testCase : cases) {
            if (testCase.priority().toLowerCase(Locale.ROOT).contains("high") && high.size() < 3) {
                high.add(testCase.title());
            }
        }
        if (high.isEmpty()) {
            for (TestCase testCase : cases) {
                if (high.size() == 3) {
                    break;
                }
                high.add(testCase.title());
            }
        }
        return String.join("; ", high);
    }

    static boolean isGuard(TestCase testCase) {
        String type = testCase.type().toLowerCase(Locale.ROOT);
        return type.contains("negative")
                || type.contains("boundary")
                || type.contains("invalid")
                || type.contains("error");
    }

    static Map<String, List<TestCase>> groupByModule(List<TestCase> cases) {
        Map<String, List<TestCase>> grouped = new LinkedHashMap<>();
        for (TestCase testCase : cases) {
            grouped.computeIfAbsent(testCase.module(), key -> new ArrayList<>()).add(testCase);
        }
        return grouped;
    }

    private static List<String> unique(List<TestCase> cases, java.util.function.Function<TestCase, String> reader) {
        Set<String> values = new LinkedHashSet<>();
        for (TestCase testCase : cases) {
            String value = reader.apply(testCase);
            if (value != null && !value.isBlank()) {
                values.add(value.trim());
            }
        }
        return new ArrayList<>(values);
    }

    private static String joinUnique(
            List<TestCase> cases,
            java.util.function.Function<TestCase, String> reader,
            String separator) {
        String joined = String.join(separator, unique(cases, reader));
        return joined.isBlank() ? "—" : joined;
    }

    private static void heading(XWPFDocument document, String text) {
        paragraph(document, text, 18, true, NAVY, ParagraphAlignment.LEFT, 320, 80);
    }

    private static void subheading(XWPFDocument document, String text) {
        paragraph(document, text, 14, true, NAVY, ParagraphAlignment.LEFT, 200, 60);
    }

    private static void bullet(XWPFDocument document, String text) {
        XWPFParagraph paragraph = document.createParagraph();
        paragraph.setAlignment(ParagraphAlignment.LEFT);
        paragraph.setSpacingBefore(20);
        paragraph.setSpacingAfter(20);
        paragraph.setIndentationLeft(360);
        run(paragraph, "•  " + text, 12, false, INK);
    }

    private static void paragraph(
            XWPFDocument document,
            String text,
            int size,
            boolean bold,
            String color,
            ParagraphAlignment alignment,
            int before,
            int after) {
        XWPFParagraph paragraph = document.createParagraph();
        paragraph.setAlignment(alignment);
        paragraph.setSpacingBefore(before);
        paragraph.setSpacingAfter(after);
        run(paragraph, text, size, bold, color);
    }

    private static void writeHeader(XWPFTableRow row, String[] headers, int[] widths) {
        row.setRepeatHeader(true);
        for (int column = 0; column < headers.length; column++) {
            fillCell(row.getCell(column), headers[column], true, HEADER_FILL, "FFFFFF", widths[column]);
        }
    }

    private static void writeBodyRow(XWPFTableRow row, String[] values, int[] widths, String fill) {
        for (int column = 0; column < values.length; column++) {
            fillCell(row.getCell(column), values[column], false, fill, INK, widths[column]);
        }
    }

    private static void lockTable(XWPFTable table, int[] widths) {
        int total = 0;
        for (int width : widths) {
            total += width;
        }
        CTTblPr properties = table.getCTTbl().getTblPr();
        if (properties == null) {
            properties = table.getCTTbl().addNewTblPr();
        }
        CTTblWidth width = properties.isSetTblW() ? properties.getTblW() : properties.addNewTblW();
        width.setType(STTblWidth.DXA);
        width.setW(BigInteger.valueOf(total));
        CTTblLayoutType layout = properties.isSetTblLayout() ? properties.getTblLayout() : properties.addNewTblLayout();
        layout.setType(STTblLayoutType.FIXED);

        CTTblGrid grid = table.getCTTbl().getTblGrid();
        if (grid == null) {
            grid = table.getCTTbl().addNewTblGrid();
        }
        while (grid.sizeOfGridColArray() > 0) {
            grid.removeGridCol(0);
        }
        for (int columnWidth : widths) {
            CTTblGridCol column = grid.addNewGridCol();
            column.setW(BigInteger.valueOf(columnWidth));
        }
    }

    private static void fillCell(
            XWPFTableCell cell,
            String text,
            boolean header,
            String fill,
            String color,
            int width) {
        cell.setColor(fill);
        cell.setVerticalAlignment(XWPFTableCell.XWPFVertAlign.CENTER);
        CTTcPr properties = cell.getCTTc().isSetTcPr() ? cell.getCTTc().getTcPr() : cell.getCTTc().addNewTcPr();
        CTTblWidth cellWidth = properties.isSetTcW() ? properties.getTcW() : properties.addNewTcW();
        cellWidth.setType(STTblWidth.DXA);
        cellWidth.setW(BigInteger.valueOf(width));

        XWPFParagraph paragraph = cell.getParagraphs().isEmpty()
                ? cell.addParagraph()
                : cell.getParagraphs().get(0);
        paragraph.setAlignment(ParagraphAlignment.LEFT);
        paragraph.setSpacingBefore(40);
        paragraph.setSpacingAfter(40);
        while (!paragraph.getRuns().isEmpty()) {
            paragraph.removeRun(0);
        }
        String[] lines = text == null || text.isBlank() ? new String[] {""} : text.split("\\R", -1);
        for (int i = 0; i < lines.length; i++) {
            if (i > 0) {
                paragraph.createRun().addBreak();
            }
            run(paragraph, lines[i], 10, header, color);
        }
    }

    private static void run(XWPFParagraph paragraph, String text, int size, boolean bold, String color) {
        XWPFRun run = paragraph.createRun();
        run.setFontFamily("Calibri");
        run.setFontSize(size);
        run.setBold(bold);
        run.setColor(color);
        run.setText(text == null ? "" : text);
    }
}
