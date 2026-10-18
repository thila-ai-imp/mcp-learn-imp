#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const PART_SIZE = 40;
const ALIASES = {
  id: ['test case id', 'testcase id', 'tc id', 'tc no', 'tc#', 'test id', 'id', 'case id', 'sl no', 's.no'],
  module: ['module', 'feature', 'component', 'area', 'functionality', 'application area', 'epic'],
  title: ['test case name', 'test case title', 'title', 'scenario', 'test scenario', 'summary', 'name', 'description', 'test case description'],
  steps: ['test steps', 'steps', 'procedure', 'test procedure', 'action', 'actions'],
  expected: ['expected result', 'expected results', 'expected outcome', 'expected', 'result'],
  priority: ['priority', 'severity', 'criticality'],
};

function fail(msg) {
  console.error(`ERROR ${msg}`);
  process.exit(1);
}

function cellText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if ('result' in v) return v.result == null ? '' : String(v.result);
    if ('text' in v) return String(v.text);
    if ('error' in v) return '';
  }
  return String(v).trim();
}

function norm(s) {
  return s.toLowerCase().replace(/[^a-z0-9# ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function mapHeaders(headers) {
  const map = {};
  const normed = headers.map(norm);
  for (const field of Object.keys(ALIASES)) {
    for (const alias of ALIASES[field]) {
      const idx = normed.findIndex((h, i) => h === alias && !Object.values(map).includes(i));
      if (idx >= 0) { map[field] = idx; break; }
    }
    if (map[field] !== undefined) continue;
    for (const alias of ALIASES[field]) {
      const idx = normed.findIndex((h, i) => h.includes(alias) && !Object.values(map).includes(i));
      if (idx >= 0) { map[field] = idx; break; }
    }
  }
  return map;
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'module';
}

async function readCases(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const out = [];
  let seq = 0;
  for (const ws of wb.worksheets) {
    if (ws.rowCount < 2) continue;
    let headerRow = 0;
    for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
      const filled = (ws.getRow(r).values || []).filter((c) => cellText(c) !== '').length;
      if (filled >= 2) { headerRow = r; break; }
    }
    if (!headerRow) continue;
    const width = ws.columnCount;
    const headers = [];
    for (let c = 1; c <= width; c++) headers.push(cellText(ws.getRow(headerRow).getCell(c).value));
    const map = mapHeaders(headers);
    if (map.title === undefined && map.steps === undefined && map.expected === undefined) continue;
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const get = (f) => (map[f] === undefined ? '' : cellText(row.getCell(map[f] + 1).value));
      const title = get('title');
      const steps = get('steps');
      const expected = get('expected');
      if (!title && !steps && !expected) continue;
      seq += 1;
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

async function main() {
  const input = process.argv[2];
  if (!input) fail('Pass the path to an .xlsx file.');
  const abs = path.resolve(input);
  if (!fs.existsSync(abs)) fail(`File not found: ${input}`);

  let cases;
  try {
    cases = await readCases(abs);
  } catch (e) {
    fail(e.message);
  }
  if (!cases.length) fail('No test cases found. Use columns such as Module, Test Case Name, Test Steps, Expected Result.');

  const work = path.join(process.cwd(), '.testdoc', 'work');
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(path.join(work, 'parts'), { recursive: true });
  fs.mkdirSync(path.join(work, 'analysis'), { recursive: true });

  const groups = new Map();
  for (const tc of cases) {
    const name = tc.module || 'General';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(tc);
  }

  const modules = [];
  let n = 0;
  let mdBytes = 0;
  for (const [name, list] of groups) {
    const parts = [];
    for (let i = 0; i < list.length; i += PART_SIZE) {
      n += 1;
      const slice = list.slice(i, i + PART_SIZE);
      const stem = `${String(n).padStart(2, '0')}-${slug(name)}`;
      const file = `parts/${stem}.md`;
      const analysis = `analysis/${stem}.json`;
      const lines = [`# Module: ${name}`, `Test cases in this part: ${slice.length}`, ''];
      for (const tc of slice) {
        lines.push(`## ${tc.id} - ${tc.title}`);
        if (tc.steps) lines.push(`- Steps: ${tc.steps.replace(/\s+/g, ' ')}`);
        if (tc.expected) lines.push(`- Expected: ${tc.expected.replace(/\s+/g, ' ')}`);
        if (tc.priority) lines.push(`- Priority: ${tc.priority}`);
        lines.push('');
      }
      const body = lines.join('\n');
      mdBytes += Buffer.byteLength(body);
      fs.writeFileSync(path.join(work, file), body);
      parts.push({ file, analysis, count: slice.length });
      console.log(`${n}. ${file} -> ${analysis} (${slice.length} cases)`);
    }
    modules.push({ name, count: list.length, parts });
  }

  const estimatedInputTokens = Math.ceil(mdBytes / 4);
  const index = {
    source: path.basename(abs),
    generatedAt: new Date().toISOString(),
    testCases: cases.length,
    modules,
    estimatedInputTokens,
  };
  fs.writeFileSync(path.join(work, 'index.json'), JSON.stringify(index, null, 2));
  fs.writeFileSync(path.join(work, 'testcases.json'), JSON.stringify(cases, null, 2));
  console.log(`INDEX .testdoc/work/index.json`);
  console.log(`estimatedInputTokens ${estimatedInputTokens}`);
}

main().catch((e) => fail(e.message));
