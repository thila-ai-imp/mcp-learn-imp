package com.mcptool.knowledge;

import org.apache.poi.hssf.usermodel.HSSFWorkbook;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class KnowledgePipelineTest {

    @TempDir
    Path temp;

    @Test
    void xlsxBecomesAnInductionDocument() throws Exception {
        Path input = temp.resolve("input");
        Path output = temp.resolve("output");
        Files.createDirectories(input);
        writeWorkbook(input.resolve("payments.xlsx"), true);

        FolderScan scan = ExcelFolder.scan(input);
        assertEquals(1, scan.excelFiles().size());
        assertEquals(3, scan.testCaseCount());

        GenerateResult result = KnowledgeService.generate(input.toString(), output.toString());
        assertEquals(2, result.moduleCount());
        assertTrue(result.outputFile().contains("ProductKnowledgeInduction_"));
        assertTrue(Files.size(Path.of(result.outputFile())) > 1000);
    }

    @Test
    void xlsIsAcceptedAndCsvIsRejected() throws Exception {
        Path input = temp.resolve("input");
        Files.createDirectories(input);
        writeWorkbook(input.resolve("legacy.xls"), false);
        Files.writeString(input.resolve("notes.csv"), "id,title\n1,Nope\n", StandardCharsets.UTF_8);

        FolderScan scan = ExcelFolder.scan(input);
        assertEquals(1, scan.excelFiles().size());
        assertEquals(3, scan.testCaseCount());
        assertTrue(scan.skippedFiles().get(0).contains("CSV is not accepted"));
        assertNull(ExcelFolder.rejectionReason(input.resolve("legacy.xls")));
        assertEquals("id", ExcelFolder.canonical("Test Case ID"));
    }

    @Test
    void folderWithOnlyCsvFailsValidation() throws Exception {
        Path input = temp.resolve("input");
        Files.createDirectories(input);
        Files.writeString(input.resolve("cases.csv"), "Title\nPlace order\n", StandardCharsets.UTF_8);

        IllegalArgumentException error = assertThrows(
                IllegalArgumentException.class,
                () -> KnowledgeService.generate(input.toString(), temp.resolve("out").toString()));
        assertTrue(error.getMessage().contains(".xls or .xlsx"));
    }

    private static void writeWorkbook(Path file, boolean xlsx) throws Exception {
        try (Workbook workbook = xlsx ? new XSSFWorkbook() : new HSSFWorkbook()) {
            Sheet sheet = workbook.createSheet("Master");
            String[] headers = {
                    "Test Case ID", "Module", "Feature", "Title", "Description",
                    "Preconditions", "Steps", "Expected Result", "Priority", "Type"
            };
            Row header = sheet.createRow(0);
            for (int i = 0; i < headers.length; i++) {
                header.createCell(i).setCellValue(headers[i]);
            }
            addRow(sheet, 1, new String[] {
                    "TC-100", "Checkout", "Place order", "Place order",
                    "Customer places an order from the cart.",
                    "Customer is signed in and the cart has one item.",
                    "1. Open the catalog\n2. Add the item\n3. Submit the order",
                    "The order confirmation number is shown.", "High", "Functional"
            });
            addRow(sheet, 2, new String[] {
                    "TC-101", "Checkout", "Place order", "Apply coupon",
                    "A valid coupon reduces the cart total.",
                    "A coupon is available.",
                    "1. Open the cart\n2. Enter the coupon code",
                    "The discounted total is shown.", "Medium", "Functional"
            });
            addRow(sheet, 3, new String[] {
                    "TC-301", "Payments", "Card payment", "Reject an expired card",
                    "An expired card must not take payment.",
                    "The customer is on the payment step.",
                    "1. Enter an expired card\n2. Confirm the payment",
                    "The payment is declined and the cart is unchanged.", "High", "Negative"
            });
            try (OutputStream out = Files.newOutputStream(file)) {
                workbook.write(out);
            }
        }
    }

    private static void addRow(Sheet sheet, int index, String[] values) {
        Row row = sheet.createRow(index);
        for (int i = 0; i < values.length; i++) {
            row.createCell(i).setCellValue(values[i]);
        }
    }
}
