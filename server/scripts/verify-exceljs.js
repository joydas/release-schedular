'use strict';

/**
 * Temporary smoke test for Phase 1.1: ExcelJS memory round-trip verification.
 * Tests in-memory workbook creation, worksheet addition, buffer serialization,
 * buffer deserialization, and cell value inspection.
 */
const ExcelJS = require('exceljs');

async function verifyExcelJS() {
  console.log('--- EXCELJS IN-MEMORY VERIFICATION (PHASE 1.1) ---');

  // 1. Create first workbook instance in memory
  const wb1 = new ExcelJS.Workbook();
  wb1.creator = 'Release Scheduler Test';
  wb1.created = new Date();

  const sheetName = 'SmokeTest';
  const ws1 = wb1.addWorksheet(sheetName);

  ws1.columns = [
    { header: 'ID', key: 'id', width: 10 },
    { header: 'Feature', key: 'feature', width: 30 },
    { header: 'BuildEffort', key: 'buildEffort', width: 15 },
    { header: 'STEffort', key: 'stEffort', width: 15 },
  ];

  ws1.addRow({ id: 'FEAT-001', feature: 'Core Engine', buildEffort: 40, stEffort: 20 });
  ws1.addRow({ id: 'FEAT-002', feature: 'Gantt View', buildEffort: 60, stEffort: 30 });

  // 2. Serialize to buffer
  const buffer = await wb1.xlsx.writeBuffer();
  console.log(`Serialized workbook to buffer (${buffer.byteLength || buffer.length} bytes)`);

  if (!buffer || (buffer.byteLength === 0 && buffer.length === 0)) {
    throw new Error('Serialized buffer is empty');
  }

  // 3. Load buffer into second workbook instance
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(buffer);
  console.log('Loaded buffer into new ExcelJS Workbook instance');

  // 4. Verify contents
  const ws2 = wb2.getWorksheet(sheetName);
  if (!ws2) {
    throw new Error(`Worksheet "${sheetName}" not found in loaded workbook`);
  }
  console.log(`Verified worksheet exists: "${ws2.name}"`);

  // Verify headers (Row 1)
  const headerValues = ws2.getRow(1).values;
  const headers = Array.isArray(headerValues)
    ? headerValues.filter((v) => v !== undefined && v !== null)
    : [];
  console.log('Headers in loaded sheet:', headers);

  if (headers.length < 4 || headers[0] !== 'ID' || headers[1] !== 'Feature') {
    throw new Error(`Unexpected headers: ${JSON.stringify(headers)}`);
  }

  // Verify Row 2
  const row2 = ws2.getRow(2).values.filter((v) => v !== undefined && v !== null);
  console.log('Row 2 in loaded sheet:', row2);
  if (row2[0] !== 'FEAT-001' || row2[1] !== 'Core Engine' || Number(row2[2]) !== 40) {
    throw new Error(`Row 2 mismatch: ${JSON.stringify(row2)}`);
  }

  // Verify Row 3
  const row3 = ws2.getRow(3).values.filter((v) => v !== undefined && v !== null);
  console.log('Row 3 in loaded sheet:', row3);
  if (row3[0] !== 'FEAT-002' || row3[1] !== 'Gantt View' || Number(row3[3]) !== 30) {
    throw new Error(`Row 3 mismatch: ${JSON.stringify(row3)}`);
  }

  console.log('>>> EXCELJS ROUND-TRIP VERIFICATION SUCCESSFUL <<<');
}

verifyExcelJS().catch((err) => {
  console.error('>>> EXCELJS VERIFICATION FAILED:', err.message);
  process.exit(1);
});
