package com.mcptool.knowledge;

/** One test-case row after Excel headers have been mapped. */
public record TestCase(
        String sourceFile,
        String sheet,
        String id,
        String module,
        String feature,
        String title,
        String description,
        String preconditions,
        String steps,
        String expectedResult,
        String priority,
        String type) {
}
