package com.mcptool.knowledge;

import java.util.List;

/** What the scanner found before any Word file is written. */
public record FolderScan(
        String inputFolder,
        List<String> excelFiles,
        int sheetCount,
        int testCaseCount,
        List<String> skippedFiles,
        List<String> warnings) {
}
