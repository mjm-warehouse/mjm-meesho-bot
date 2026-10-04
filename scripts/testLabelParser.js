const fs = require('fs');
const pdf = require('pdf-parse');
const { parseDispatchPage } = require('../parsers/dispatchParser');

async function testPdf() {
  const files = fs.readdirSync('.').filter(f => f.toLowerCase().endsWith('.pdf'));
  if (files.length === 0) {
    console.log('⚠️ Koi PDF file root directory me nahi mili.');
    return;
  }

  const pdfPath = files[0];
  console.log(`📄 Testing on file: ${pdfPath}`);
  const dataBuffer = fs.readFileSync(pdfPath);

  const data = await pdf(dataBuffer);
  // Split on TAX INVOICE delimiter per Meesho label page
  const pages = data.text.split(/(?=Customer Address)/i).filter(p => p.trim().length > 50);
  console.log(`📦 Total label pages detected: ${pages.length}\n`);

  const previewCount = Math.min(3, pages.length);
  for (let i = 0; i < previewCount; i++) {
    const parsed = parseDispatchPage(pages[i]);
    console.log(`--- [LABEL ${i + 1}] ---`);
    console.log(parsed);
    console.log('----------------------\n');
  }
}

testPdf().catch(console.error);
