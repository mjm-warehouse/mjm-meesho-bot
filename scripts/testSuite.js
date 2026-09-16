// scripts/testSuite.js
//
// Standalone local "dry run" test suite. Runs entirely offline against mock
// text/data — no real PDFs, no live Google Sheets, no Telegram calls.
//
// It works by injecting a fake in-memory implementation into Node's module
// cache for lib/sheets.js *before* any other project file requires it. Every
// module that does `require('./sheets')` resolves to the same absolute file
// path, so they all transparently pick up the mock instead of hitting the
// real Google Sheets API — no credentials, no network needed.
//
// Run with:  node scripts/testSuite.js

const sheetsPath = require.resolve('../lib/sheets');

const mockTabs = {
  Orders_Dispatch: [
    ['Packet ID', 'Forward AWB', 'Sub Order ID', 'Customer Name', 'SKU', 'Product Name',
      'Qty', 'Invoice Amount', 'Product Cost', 'Packaging Cost', 'Payment Mode',
      'Courier Partner', 'City', 'District', 'State', 'Pincode', 'Order Date',
      'Status', 'Action Handler', 'Last Updated'],
    ['PKT-00001', 'VL0085271792522', '325644970746830464_1', 'sachin raj',
      'MJM-AIRDOPES-PRIME-GREEN', 'Airdopes Prime', 1, 450, 150, 20, 'Prepaid',
      'Valmo', 'Malur', 'Kolar', 'Karnataka', '563130', '31.08.2026',
      'Dispatched', 'System', '2026-08-31T00:00:00.000Z'],
  ],
  Customer_Risk_Intelligence: [
    ['Pincode', 'City', 'State', 'Customer Name', 'Total Orders', 'Fraud Returns',
      'RTO Count', 'Risk Level', 'Fraud Loss', 'Delivered Count', 'Customer Tag', 'Pattern Notes'],
  ],
  Payment_Reconciliation: [
    ['Payment Date', 'Sub Order ID', 'Live Status', 'Gross Sale', 'Marketplace Fee',
      'Return Shipping Fee', 'Net Settlement', 'Bank Status', 'Discrepancy'],
  ],
};

const appendedLog = {};

const mockSheetsExports = {
  async readTab(tabName) {
    return mockTabs[tabName] ? mockTabs[tabName].map((r) => [...r]) : [[]];
  },
  async appendRows(tabName, rows) {
    if (!mockTabs[tabName]) mockTabs[tabName] = [[]];
    mockTabs[tabName].push(...rows);
    appendedLog[tabName] = (appendedLog[tabName] || []).concat(rows);
  },
  async updateRow(tabName, rowIndex1Based, rowValues) {
    if (!mockTabs[tabName]) return;
    mockTabs[tabName][rowIndex1Based - 1] = rowValues;
  },
};

require.cache[sheetsPath] = {
  id: sheetsPath,
  filename: sheetsPath,
  loaded: true,
  exports: mockSheetsExports,
};

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition, label) {
  if (!condition) throw new Error(label);
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ PASS - ${name}`);
    passed += 1;
  } catch (err) {
    console.log(`❌ FAIL - ${name}`);
    console.log(`   → ${err.message}`);
    failed += 1;
  }
}

async function testForwardLabelParsing() {
  const { parseDispatchPdf } = require('../parsers/dispatchParser');

  const valmoPage = `Customer Address: sachin raj, Near Advitiya Farms, Malur, Kolar District, Karnataka, 563130
Return to: MJM Enterprise, Maa Jivdani Mobile, Surat, Gujarat, 395006
Prepaid: Do not collect cash
ValmoPlus Pickup | VL0085271792522
SKU: MJM-AIRDOPES-PRIME-GREEN | Qty: 1 | Order No: 325644970746830464_1
Invoice Date: 31.08.2026 | Total: Rs.283.47`;

  const shadowfaxPage = `Customer Address: Priya Sharma, Flat 12B Sunrise Apartments, Pune City, Pune District, Maharashtra, 411001
Return to: MJM Enterprise, Maa Jivdani Mobile, Surat, Gujarat, 395006
COD: Collect cash on delivery
Shadowfax Express | SF4521789632145
SKU: MJM-EARBUDS-X1-BLACK | Qty: 2 | Order No: 412244970746830111_2
Invoice Date: 30.08.2026 | Total: Rs.599.00`;

  const delhiveryPage = `Customer Address: Karthik Raman, No 45 Anna Nagar Main Road, Chennai, Chennai District, Tamil Nadu, 600040
Return to: MJM Enterprise, Maa Jivdani Mobile, Surat, Gujarat, 395006
Prepaid: Do not collect cash
Delhivery Surface | 141234567890123
SKU: MJM-CHARGER-20W-WHITE | Qty: 1 | Order No: 512244970746830999_1
Invoice Date: 29.08.2026 | Total: Rs.349.00`;

  const records = parseDispatchPdf([
    { text: valmoPage },
    { text: shadowfaxPage },
    { text: delhiveryPage },
  ]);

  assertEqual(records.length, 3, 'should parse all 3 pages into records');

  const [valmo, shadowfax, delhivery] = records;

  assertEqual(valmo.forwardAwb, 'VL0085271792522', 'Valmo AWB');
  assertEqual(valmo.courierPartner, 'Valmo', 'Valmo courier name');
  assertEqual(valmo.paymentMode, 'Prepaid', 'Valmo payment mode');
  assertEqual(valmo.subOrderId, '325644970746830464_1', 'Valmo sub order ID');
  assertEqual(valmo.sku, 'MJM-AIRDOPES-PRIME-GREEN', 'Valmo SKU');
  assertEqual(valmo.invoiceAmount, 283.47, 'Valmo invoice amount');
  assertEqual(valmo.state, 'Karnataka', 'Valmo state (must NOT be seller\'s Gujarat)');
  assertEqual(valmo.pincode, '563130', 'Valmo pincode (must NOT be seller\'s 395006)');
  assertEqual(valmo.city, 'Malur', 'Valmo city');
  assertEqual(valmo.district, 'Kolar', 'Valmo district');

  assertEqual(shadowfax.forwardAwb, 'SF4521789632145', 'Shadowfax AWB');
  assertEqual(shadowfax.courierPartner, 'Shadowfax', 'Shadowfax courier name');
  assertEqual(shadowfax.paymentMode, 'COD', 'Shadowfax payment mode');
  assertEqual(shadowfax.subOrderId, '412244970746830111_2', 'Shadowfax sub order ID');
  assertEqual(shadowfax.sku, 'MJM-EARBUDS-X1-BLACK', 'Shadowfax SKU');
  assertEqual(shadowfax.invoiceAmount, 599.00, 'Shadowfax invoice amount');
  assertEqual(shadowfax.state, 'Maharashtra', 'Shadowfax state');
  assertEqual(shadowfax.pincode, '411001', 'Shadowfax pincode');

  assertEqual(delhivery.forwardAwb, '141234567890123', 'Delhivery AWB');
  assertEqual(delhivery.courierPartner, 'Delhivery', 'Delhivery courier name');
  assertEqual(delhivery.paymentMode, 'Prepaid', 'Delhivery payment mode');
  assertEqual(delhivery.subOrderId, '512244970746830999_1', 'Delhivery sub order ID');
  assertEqual(delhivery.invoiceAmount, 349.00, 'Delhivery invoice amount');
  assertEqual(delhivery.state, 'Tamil Nadu', 'Delhivery state');
  assertEqual(delhivery.pincode, '600040', 'Delhivery pincode');
}

async function testPodParsingAndClassification() {
  const { parsePodPdf } = require('../parsers/podParser');

  const podText = `Seller Return Delivery Report
Phone: 70XXXXXXX2 | Date: 28 Aug, 2026
Rider Name: Test Rider Kumar
1 | SF3789513392FPL TAMPERED | 317538326565774912_1_qov | FTPL
2 | SF9988776655FPL OK | 417538326565774912_1_repl_fyu | Meesho Exchange
3 | SF1122334455FPL TAMPERED | 517538326565774912_1_RET_vjw | Customer Return
Shipments Delivered: 3`;

  const rows = parsePodPdf([{ text: podText }]);
  assertEqual(rows.length, 3, 'should parse all 3 return lines');

  const [rtoRow, exchangeRow, customerRow] = rows;

  assertEqual(rtoRow.reverseAwb, 'SF3789513392FPL', 'row 1 AWB');
  assertEqual(rtoRow.condition, 'TAMPERED', 'row 1 condition');
  assertEqual(rtoRow.returnType, 'RTO Return', 'row 1 classification');

  assertEqual(exchangeRow.reverseAwb, 'SF9988776655FPL', 'row 2 AWB');
  assertEqual(exchangeRow.condition, 'OK', 'row 2 condition');
  assertEqual(exchangeRow.returnType, 'Meesho Exchange', 'row 2 classification');

  assertEqual(customerRow.reverseAwb, 'SF1122334455FPL', 'row 3 AWB');
  assertEqual(customerRow.condition, 'TAMPERED', 'row 3 condition');
  assertEqual(customerRow.returnType, 'Customer Return', 'row 3 classification');
}

async function testRiskScoring() {
  const { computeRiskLevel, computeCustomerTag } = require('../lib/riskEngine');

  assertEqual(computeRiskLevel(0), 'OK', 'no fraud returns -> OK');
  assertEqual(computeRiskLevel(1), '🟡 WATCHLIST', '1 tampered return -> WATCHLIST');
  assertEqual(computeRiskLevel(2), '🔴 BLACKLIST / HIGH RISK', '2 tampered returns -> BLACKLIST');
  assertEqual(computeRiskLevel(5), '🔴 BLACKLIST / HIGH RISK', '5 tampered returns -> still BLACKLIST');

  assertEqual(computeCustomerTag(3, 0, 0), '⭐ VIP Repeat Customer', '3 orders, 0 fraud, 0 RTO -> VIP');
  assertEqual(computeCustomerTag(1, 0, 0), '🟢 Genuine Buyer', '1 order, 0 fraud -> Genuine Buyer');
  assertEqual(computeCustomerTag(5, 0, 3), '⚠️ High RTO Risk', '3/5=60% RTO -> High RTO Risk');
  assertEqual(computeCustomerTag(4, 1, 0), '🚨 Blacklisted / Fraudster', '1+ fraud -> Blacklisted regardless of orders');
}

async function testPaymentReconciliation() {
  let XLSX;
  try {
    XLSX = require('xlsx');
  } catch (err) {
    throw new Error('xlsx package not installed — run "npm install" in the project root first.');
  }

  const { processReconciliationFile } = require('../lib/processReconciliation');

  const sheetData = [
    ['Sub Order ID', 'Gross Sale Amount', 'Marketplace Deductions', 'Net Settlement Amount', 'Payment Date'],
    ['325644970746830464_1', 400, 20, 380, '01-09-2026'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Settlement');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const result = await processReconciliationFile(buffer);

  assertEqual(result.count, 1, 'should log 1 reconciliation row');
  assertEqual(result.discrepancies, 1, 'should flag exactly 1 discrepancy (400 vs invoice 450)');

  const loggedRows = appendedLog.Payment_Reconciliation || [];
  assertTrue(loggedRows.length === 1, 'Payment_Reconciliation should have exactly 1 appended row');
  const [, subOrderId, , grossSale, , , , , discrepancy] = loggedRows[0];
  assertEqual(subOrderId, '325644970746830464_1', 'logged sub order ID matches');
  assertEqual(grossSale, 400, 'logged gross sale matches settlement file');
  assertTrue(!!discrepancy, `discrepancy note should be non-empty, got: ${JSON.stringify(discrepancy)}`);
}

async function main() {
  console.log('\n=== MJM Meesho Bot — Local Mock Test Suite (dry run) ===\n');

  await test('Forward Label Parsing (Valmo / Shadowfax / Delhivery, Prepaid / COD)', testForwardLabelParsing);
  await test('POD / Return Parsing & Classification', testPodParsingAndClassification);
  await test('Risk Scoring Engine (computeRiskLevel + computeCustomerTag)', testRiskScoring);
  await test('Payment Reconciliation discrepancy detection', testPaymentReconciliation);

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();