#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const LABELS = {
  flows: 'Flows',
  businessRules: 'Business rules',
  validations: 'Validations',
  dependencies: 'Dependencies',
  testCases: 'Test cases',
};

function fail(msg) {
  console.error(`ERROR ${msg}`);
  process.exit(1);
}

function xml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function p(text, style) {
  const st = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
  return `<w:p>${st}<w:r><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`;
}

function bullets(items) {
  if (!Array.isArray(items) || !items.length) return p('None recorded from the test cases.');
  return items.map((item) => p(`• ${item}`)).join('');
}

function parseArgs(argv) {
  const out = { work: '.testdoc/work', agent: 'KnowledgeAgent', suffix: 'knowledge', sections: Object.keys(LABELS) };
  const rest = argv.slice(2);
  if (rest[0] && !rest[0].startsWith('--')) out.work = rest.shift();
  while (rest.length) {
    const flag = rest.shift();
    const val = rest.shift() || '';
    if (flag === '--agent') out.agent = val;
    if (flag === '--suffix') out.suffix = val;
    if (flag === '--sections') out.sections = val.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv);
  const work = path.resolve(opts.work);
  const indexPath = path.join(work, 'index.json');
  if (!fs.existsSync(indexPath)) fail(`Missing ${indexPath}. Run read-excel.cjs first.`);
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const overviewPath = path.join(work, 'overview.json');
  const overview = fs.existsSync(overviewPath) ? JSON.parse(fs.readFileSync(overviewPath, 'utf8')) : { overview: '', openQuestions: [] };

  let body = '';
  body += p('Application Knowledge', 'Title');
  body += p(`${opts.agent} · ${index.source || ''} · ${index.testCases || 0} test cases · ${index.modules?.length || 0} modules`);
  if (overview.overview) {
    body += p('Overview', 'Heading1');
    body += p(overview.overview);
  }

  for (const mod of index.modules || []) {
    for (const part of mod.parts || []) {
      const file = path.join(work, part.analysis);
      if (!fs.existsSync(file)) fail(`Missing analysis file ${part.analysis}`);
      let json;
      try {
        json = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        fail(`Invalid JSON in ${part.analysis}`);
      }
      body += p(mod.name, 'Heading1');
      if (json.purpose) body += p(json.purpose);
      for (const key of opts.sections) {
        if (!LABELS[key] || json[key] == null) continue;
        body += p(LABELS[key], 'Heading2');
        body += Array.isArray(json[key]) ? bullets(json[key]) : p(String(json[key]));
      }
    }
  }

  if (Array.isArray(overview.openQuestions) && overview.openQuestions.length) {
    body += p('Open questions', 'Heading1');
    body += bullets(overview.openQuestions);
  }

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body>
</w:document>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="48"/><w:color w:val="0B6ED4"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="12324D"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:rPr><w:b/><w:sz w:val="24"/><w:color w:val="2B8CFF"/></w:rPr></w:style>
</w:styles>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
  zip.file('word/document.xml', documentXml);
  zip.file('word/styles.xml', stylesXml);

  const stem = path.basename(index.source || 'document', path.extname(index.source || '')).replace(/\s+/g, '-');
  const outDir = path.join(process.cwd(), '.testdoc', 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const outName = `${stem}-${opts.suffix}.docx`;
  const outPath = path.join(outDir, outName);
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(outPath, buf);
  const rel = path.posix.join('.testdoc', 'output', outName);
  console.log(`DOCUMENT_CREATED ${rel}`);
  console.log(`estimatedOutputTokens ${Math.ceil(body.length / 4)}`);
}

main().catch((e) => fail(e.message));
