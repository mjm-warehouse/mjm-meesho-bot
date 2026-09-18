// scripts/testSuite.js
//
// Standalone local "dry run" test suite. Runs entirely offline against mock
// text/data — no real PDFs, no live Google Sheets, no Telegram calls.
//
// Run with:  node scripts/testSuite.js

const sheetsPath = require.resolve('../lib/sheets');

const TODAY = new Date().toISOString().slice(0, 10);
const twoMonthsAgo = new Date();
twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
const OLD_DATE = twoMonthsAgo.toISOString().slice(0, 10);

const mockTabs = {
  Orders_Dispatch: [
    ['Packet ID', 'Forward AWB', 'Sub Order ID', 'Customer Name', 'SKU', 'Product Name',
      'Qty', 'Invoice Amount', 'Product Cost', 'Packaging Cost', 'Payment Mode',
      'Courier Partner', 'City', 'District', 'State', 'Pincode', 'Order Date',
      'Status', 'Action Handler', 'Last Updated'],
    ['PKT-00001', 'VL0085271792522', '325644970746830464_1', 'sachin raj',
      'MJM-AIRDOPES-PRIME-GREEN', 'Airdopes Prime', 1, 450, 150, 20, 'Prepaid',
      'Valmo', 'Malur', 'Kolar', 'Karnataka', '563130', TODAY,
      'Dispatched', 'System', '2026-08-31T00:00:00.000Z'],
    ['PKT-00002', 'VL_OLD_ORDER', 'SO-OLD-1', 'Old Customer',
      'MJM-AIRDOPES-PRIME-GREEN', 'Airdopes Prime', 1, 300, 150, 20, 'COD',
      'Valmo', 'City', 'Dist', 'State', '111111', OLD_DATE,
      'Dispatched', 'System', OLD_DATE],
  ],
  Customer_Risk_Intelligence: [
    ['Pincode', 'City', 'State', 'Customer Name', 'Total Orders', 'Fraud Returns',
      'RTO Count', 'Risk Level', 'Fraud Loss', 'Delivered Count', 'Customer Tag', 'Pattern Notes'],
  ],
  Payment_Reconciliation: [
    ['Payment Date', 'Sub Order ID', 'Live Status', 'Gross Sale', 'Marketplace Fee',
      'Return Shipping Fee', 'Net Settlement', 'Bank Status', 'Discrepancy'],
    [TODAY, '325644970746830464_1', 'Settled', 450, 20, '', 430, 'Settled', ''],
  ],
  Returns_Tracking: [
    ['Return Date', 'Reverse AWB', 'Original AWB', 'Sub Order ID', 'Return Type',
      'Courier', 'Rider Info', 'Condition', 'Status', 'Relinked AWB', 'Remarks'],
  ],
  Claims_Manager: [
    ['Received Date', 'Sub Order ID', 'Reverse AWB', 'SKU', 'Claim Deadline',
      'Days Left', 'Issue Type', 'Status', 'Claim Value', 'Remarks'],
  ],
  SKU_Master_Costing: [
    ['SKU ID', 'Product Name', 'Product Cost', 'Packaging Cost', 'Total Base Cost', 'Last Updated',
      'Listing Sale Price', 'Physical Stock', 'Current Balance', 'Meesho Listed Stock'],
    ['MJM-AIRDOPES-PRIME-GREEN', 'Airdopes Prime', 150, 20, 170, TODAY, 599, 10, 7, 10],
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

// ---------------------------------------------------------------------------
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

  const records = parseDispatchPdf([{ text: valmoPage }, { text: shadowfaxPage }, { text: delhiveryPage }]);

  assertEqual(records.length, 3, 'should parse all 3 pages into records');
  const [valmo, shadowfax, delhivery] = records;

  assertEqual(valmo.forwardAwb, 'VL0085271792522', 'Valmo AWB');
  assertEqual(valmo.paymentMode, 'Prepaid', 'Valmo payment mode');
  assertEqual(valmo.state, 'Karnataka', 'Valmo state (must NOT be seller\'s Gujarat)');
  assertEqual(valmo.pincode, '563130', 'Valmo pincode (must NOT be seller\'s 395006)');

  assertEqual(shadowfax.forwardAwb, 'SF4521789632145', 'Shadowfax AWB');
  assertEqual(shadowfax.paymentMode, 'COD', 'Shadowfax payment mode');

  assertEqual(delhivery.forwardAwb, '141234567890123', 'Delhivery AWB');
  assertEqual(delhivery.state, 'Tamil Nadu', 'Delhivery state');
}

// ---------------------------------------------------------------------------
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

  assertEqual(rtoRow.condition, 'TAMPERED', 'row 1 condition');
  assertEqual(rtoRow.returnType, 'RTO Return', 'row 1 classification');
  assertEqual(exchangeRow.condition, 'OK', 'row 2 condition');
  assertEqual(exchangeRow.returnType, 'Meesho Exchange', 'row 2 classification');
  assertEqual(customerRow.returnType, 'Customer Return', 'row 3 classification');
}

// ---------------------------------------------------------------------------
async function testRiskScoring() {
  const { computeRiskLevel, computeCustomerTag } = require('../lib/riskEngine');

  assertEqual(computeRiskLevel(0), 'OK', 'no fraud returns -> OK');
  assertEqual(computeRiskLevel(1), '🟡 WATCHLIST', '1 tampered return -> WATCHLIST');
  assertEqual(computeRiskLevel(2), '🔴 BLACKLIST / HIGH RISK', '2 tampered returns -> BLACKLIST');

  assertEqual(computeCustomerTag(3, 0, 0), '⭐ VIP Repeat Customer', '3 orders, 0 fraud, 0 RTO -> VIP');
  assertEqual(computeCustomerTag(1, 0, 0), '🟢 Genuine Buyer', '1 order, 0 fraud -> Genuine Buyer');
  assertEqual(computeCustomerTag(5, 0, 3), '⚠️ High RTO Risk', '3/5=60% RTO -> High RTO Risk');
  assertEqual(computeCustomerTag(4, 1, 0), '🚨 Blacklisted / Fraudster', '1+ fraud -> Blacklisted regardless of orders');
}

// ---------------------------------------------------------------------------
async function testPaymentReconciliation() {
  let XLSX;
  try { XLSX = require('xlsx'); } catch (err) {
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
}

// ---------------------------------------------------------------------------
async function testUnderSettlement() {
  let XLSX;
  try { XLSX = require('xlsx'); } catch (err) {
    throw new Error('xlsx package not installed — run "npm install" first.');
  }
  const { processReconciliationFile } = require('../lib/processReconciliation');

  // Invoice for this sub-order is 450. Gross sale matches invoice (450), but
  // net settlement (380) is far below (invoice - fee = 450-20=430 expected)
  // -> should be flagged as an under-settlement, not just a gross mismatch.
  const sheetData = [
    ['Sub Order ID', 'Gross Sale Amount', 'Marketplace Deductions', 'Net Settlement Amount', 'Payment Date'],
    ['325644970746830464_1', 450, 20, 380, '01-09-2026'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Settlement');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const result = await processReconciliationFile(buffer);
  assertEqual(result.underSettlementCount, 1, 'should flag 1 under-settlement (expected ~430, got 380)');

  const loggedRows = appendedLog.Payment_Reconciliation || [];
  const lastRow = loggedRows[loggedRows.length - 1];
  assertTrue(lastRow[8].includes('Under-Settlement'), `discrepancy note should mention Under-Settlement, got: ${lastRow[8]}`);
}

// ---------------------------------------------------------------------------
async function testInventoryTracking() {
  const { decrementOnDispatch, incrementOnReturn, listInventory } = require('../lib/inventoryEngine');

  const sku = 'MJM-AIRDOPES-PRIME-GREEN'; // starts at Current Balance = 7 in mock data

  const dec1 = await decrementOnDispatch(sku, 2); // 7 -> 5
  assertEqual(dec1.newBalance, 5, 'first decrement: 7 - 2 = 5');
  assertEqual(dec1.lowStock, true, '5 <= threshold(5) -> low stock');

  const dec2 = await decrementOnDispatch(sku, 3); // 5 -> 2
  assertEqual(dec2.newBalance, 2, 'second decrement: 5 - 3 = 2');
  assertEqual(dec2.lowStock, true, 'still low stock at 2');

  const inc = await incrementOnReturn(sku, 1); // 2 -> 3
  assertEqual(inc.newBalance, 3, 'increment on OK return: 2 + 1 = 3');

  const items = await listInventory();
  const item = items.find((i) => i.sku === sku);
  assertTrue(!!item, 'listInventory should include the SKU');
  assertEqual(item.currentBalance, 3, 'listInventory reflects latest balance');
  assertEqual(item.lowStock, true, 'listInventory flags low stock correctly');

  // Reset back to original mock value (7) so this test is independently
  // re-runnable without affecting other tests' assumptions.
  await incrementOnReturn(sku, 4); // 3 -> 7
}

// ---------------------------------------------------------------------------
async function testMultiPeriodPnl() {
  const { getPnlForRange } = require('../lib/analytics');
  const { resolveDateRange } = require('../lib/dateUtils');

  // "today" period should only include today's order (₹450), not the
  // 2-months-ago order (₹300).
  const todayResult = await getPnlForRange('today');
  assertEqual(todayResult.volume.dispatched, 1, '"today" period should include only 1 order (today\'s)');
  assertEqual(todayResult.financials.grossSales, 450, '"today" gross sales should be 450 (excludes the old order)');

  // "last_6_months" should include both orders (today + 2 months ago).
  const sixMonthResult = await getPnlForRange('last_6_months');
  assertEqual(sixMonthResult.volume.dispatched, 2, '"last_6_months" should include both orders');
  assertEqual(sixMonthResult.financials.grossSales, 750, '"last_6_months" gross sales should be 450+300=750');

  // All-time (no period) should also include both, and range should be null.
  const allTimeResult = await getPnlForRange(null);
  assertEqual(allTimeResult.range, null, 'all-time range should be null');
  assertEqual(allTimeResult.volume.dispatched, 2, 'all-time should include both orders');

  // Net Real Profit uses actual settlement (430 logged for today's order),
  // not gross sales - and only counts cost for orders within the period.
  assertEqual(todayResult.financials.actualNetSettlement, 430, 'today\'s actual net settlement should be 430');
  const expectedTodayCost = 150 + 20; // product + packaging cost for the 1 order in range
  assertEqual(todayResult.financials.totalCost, expectedTodayCost, 'today\'s cost should match only the 1 in-range order');
  assertEqual(todayResult.financials.netRealProfit, 430 - expectedTodayCost, 'net real profit = actual settlement - cost - dead losses(0)');

  // Sanity-check the underlying date range resolver too.
  const range7d = resolveDateRange('7d');
  assertTrue(Array.isArray(range7d) && range7d.length === 2, '"7d" should resolve to a [from, to] range');
}

// ---------------------------------------------------------------------------
async function main() {
  console.log('\n=== MJM Meesho Bot — Local Mock Test Suite (dry run) ===\n');

  await test('Forward Label Parsing (Valmo / Shadowfax / Delhivery, Prepaid / COD)', testForwardLabelParsing);
  await test('POD / Return Parsing & Classification', testPodParsingAndClassification);
  await test('Risk Scoring Engine (computeRiskLevel + computeCustomerTag)', testRiskScoring);
  await test('Payment Reconciliation discrepancy detection', testPaymentReconciliation);
  await test('Under-Settlement / Payment Leakage detection', testUnderSettlement);
  await test('Live Inventory Tracking (dispatch -, return +, low-stock flag)', testInventoryTracking);
  await test('Multi-Period P&L Analytics (today / last_6_months / all-time)', testMultiPeriodPnl);

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();