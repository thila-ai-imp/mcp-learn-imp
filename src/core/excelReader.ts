import ExcelJS from 'exceljs';
import type { TestCase } from './types';

const ALIASES: Record<keyof TestCase, string[]> = {
  id: ['test case id', 'testcase id', 'tc id', 'tc no', 'tc#', 'test id', 'id', 'case id', 'sl no', 's.no'],
  module: ['module', 'feature', 'component', 'area', 'functionality', 'application area', 'epic'],
  title: ['test case name', 'test case title', 'title', 'scenario', 'test scenario', 'summary', 'name', 'description', 'test case description'],
  steps: ['test steps', 'steps', 'procedure', 'test procedure', 'action', 'actions'],
  expected: ['expected result', 'expected results', 'expected outcome', 'expected', 'result'],
  priority: ['priority', 'severity', 'criticality'],
};

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as Array<{ text: string }>).map((r) => r.text).join('');
    if ('result' in o) return o.result == null ? '' : String(o.result);
    if ('text' in o) return String(o.text);
    if ('error' in o) return '';
  }
  return String(v).trim();
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9# ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function mapHeaders(headers: string[]): Partial<Record<keyof TestCase, number>> {
  const map: Partial<Record<keyof TestCase, number>> = {};
  const normed = headers.map(norm);
  (Object.keys(ALIASES) as Array<keyof TestCase>).forEach((field) => {
    // exact alias match first (in alias priority order), then "contains" match
    for (const alias of ALIASES[field]) {
      const idx = normed.findIndex((h, i) => h === alias && !Object.values(map).includes(i));
      if (idx >= 0) { map[field] = idx; return; }
    }
    for (const alias of ALIASES[field]) {
      const idx = normed.findIndex((h, i) => h.includes(alias) && !Object.values(map).includes(i));
      if (idx >= 0) { map[field] = idx; return; }
    }
  });
  return map;
}

export async function readTestCases(buffer: Buffer): Promise<TestCase[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);

  const out: TestCase[] = [];
  let seq = 0;

  for (const ws of wb.worksheets) {
    if (ws.rowCount < 2) continue;

    // header = first row (within first 10) having >= 2 non-empty cells
    let headerRow = 0;
    for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
      const filled = (ws.getRow(r).values as ExcelJS.CellValue[]).filter((c) => cellText(c) !== '').length;
      if (filled >= 2) { headerRow = r; break; }
    }
    if (!headerRow) continue;

    const width = ws.columnCount;
    const headers: string[] = [];
    for (let c = 1; c <= width; c++) headers.push(cellText(ws.getRow(headerRow).getCell(c).value));
    const map = mapHeaders(headers);
    if (map.title === undefined && map.steps === undefined && map.expected === undefined) continue;

    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const get = (f: keyof TestCase): string => (map[f] === undefined ? '' : cellText(row.getCell((map[f] as number) + 1).value));
      const title = get('title');
      const steps = get('steps');
      const expected = get('expected');
      if (!title && !steps && !expected) continue;
      seq++;
      out.push({
        id: get('id') || `TC-${String(seq).padStart(3, '0')}`,
        module: get('module') || (wb.worksheets.length > 1 ? ws.name : 'General'),
        title: title || steps.split('\n')[0].slice(0, 120),
        steps,
        expected,
        priority: get('priority'),
      });
    }
  }
  return out;
}
