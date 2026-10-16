package com.mcptool.knowledge;

import java.util.ArrayList;
import java.util.List;

/**
 * A small CSV reader. It understands quotes, so a step list can contain
 * line breaks inside one cell. Comma and semicolon files are both accepted.
 */
public final class CsvTable {

    private CsvTable() {
    }

    public static List<List<String>> parse(String text) {
        if (text == null || text.isBlank()) {
            return List.of();
        }
        String normalized = text.charAt(0) == '\uFEFF' ? text.substring(1) : text;
        char delimiter = detectDelimiter(normalized);
        return parse(normalized, delimiter);
    }

    static char detectDelimiter(String text) {
        int commas = 0;
        int semicolons = 0;
        boolean inQuotes = false;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == '"') {
                inQuotes = !inQuotes;
            } else if (!inQuotes && (c == '\n' || c == '\r')) {
                break;
            } else if (!inQuotes && c == ',') {
                commas++;
            } else if (!inQuotes && c == ';') {
                semicolons++;
            }
        }
        return semicolons > commas ? ';' : ',';
    }

    static List<List<String>> parse(String text, char delimiter) {
        List<List<String>> rows = new ArrayList<>();
        List<String> row = new ArrayList<>();
        StringBuilder cell = new StringBuilder();
        boolean inQuotes = false;

        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (inQuotes) {
                if (c == '"') {
                    if (i + 1 < text.length() && text.charAt(i + 1) == '"') {
                        cell.append('"');
                        i++;
                    } else {
                        inQuotes = false;
                    }
                } else {
                    cell.append(c);
                }
                continue;
            }
            if (c == '"') {
                inQuotes = true;
            } else if (c == delimiter) {
                row.add(cell.toString().trim());
                cell.setLength(0);
            } else if (c == '\n') {
                finishRow(rows, row, cell);
                row = new ArrayList<>();
            } else if (c != '\r') {
                cell.append(c);
            }
        }
        if (cell.length() > 0 || !row.isEmpty()) {
            finishRow(rows, row, cell);
        }
        return rows;
    }

    private static void finishRow(List<List<String>> rows, List<String> row, StringBuilder cell) {
        row.add(cell.toString().trim());
        cell.setLength(0);
        boolean blank = true;
        for (String value : row) {
            if (!value.isBlank()) {
                blank = false;
                break;
            }
        }
        if (!blank) {
            rows.add(row);
        }
    }
}
