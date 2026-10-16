package com.mcptool.knowledge;

import java.util.List;

/** Paths and counts returned after the induction document is written. */
public record GenerateResult(
        String outputFile,
        int testCaseCount,
        int moduleCount,
        List<String> skippedFiles,
        List<String> warnings) {
}
