package com.mcptool.knowledge;

import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;

import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;

/** Writes the sample workbook used to try the server. Run from the project folder. */
public final class SampleWorkbook {

    private SampleWorkbook() {
    }

    public static void main(String[] args) throws Exception {
        Path folder = Path.of("input");
        Files.createDirectories(folder);
        Path file = folder.resolve("payments.xlsx");
        try (Workbook workbook = new XSSFWorkbook()) {
            Sheet sheet = workbook.createSheet("Master");
            String[] headers = {
                    "Test Case ID", "Module", "Feature", "Title", "Description",
                    "Preconditions", "Steps", "Expected Result", "Priority", "Type"
            };
            Row header = sheet.createRow(0);
            for (int i = 0; i < headers.length; i++) {
                header.createCell(i).setCellValue(headers[i]);
            }
            row(sheet, 1, "TC-100", "Checkout", "Place order", "Place order",
                    "Customer places an order from the cart.",
                    "Customer is signed in and the cart has one item.",
                    "1. Open the catalog\n2. Add the selected item to the cart\n3. Submit the order",
                    "The order confirmation number is shown.", "High", "Functional");
            row(sheet, 2, "TC-101", "Checkout", "Place order", "Apply coupon",
                    "A valid coupon reduces the cart total.",
                    "A coupon is available.",
                    "1. Open the cart\n2. Enter the coupon code\n3. Apply the coupon code",
                    "The discounted total is shown.", "Medium", "Functional");
            row(sheet, 3, "TC-300", "Payments", "Card payment", "Pay by card",
                    "A valid card completes payment.",
                    "The customer is on the payment step.",
                    "1. Enter the card\n2. Confirm the payment",
                    "The payment receipt is shown.", "High", "Functional");
            row(sheet, 4, "TC-301", "Payments", "Card payment", "Reject an expired card",
                    "An expired card must not take payment.",
                    "The customer is on the payment step.",
                    "1. Enter an expired card\n2. Confirm the payment",
                    "The payment is declined and the cart is unchanged.", "High", "Negative");
            try (OutputStream out = Files.newOutputStream(file)) {
                workbook.write(out);
            }
        }
        System.out.println("Wrote " + file.toAbsolutePath().normalize());
    }

    private static void row(Sheet sheet, int index, String... values) {
        Row row = sheet.createRow(index);
        for (int i = 0; i < values.length; i++) {
            row.createCell(i).setCellValue(values[i]);
        }
    }
}
