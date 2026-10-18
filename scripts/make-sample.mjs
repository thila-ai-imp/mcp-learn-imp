// Creates sample-testcases.xlsx for trying the app.  Usage: npm run sample
import ExcelJS from 'exceljs';

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Test Cases');
ws.addRow(['Test Case ID', 'Module', 'Test Case Name', 'Test Steps', 'Expected Result', 'Priority']);

const rows = [
  ['TC-001', 'Login', 'Valid user logs in', '1. Open login page\n2. Enter valid user id and password\n3. Click Login', 'User lands on the dashboard and name is shown in the header', 'High'],
  ['TC-002', 'Login', 'Invalid password', '1. Enter valid user id\n2. Enter wrong password', 'Error "Invalid credentials" is shown and the attempt is counted', 'High'],
  ['TC-003', 'Login', 'Account locks after 3 failed attempts', 'Enter a wrong password 3 times', 'Account is locked and user must contact admin; further logins are rejected', 'High'],
  ['TC-004', 'Login', 'Empty user id', 'Leave user id blank and click Login', 'Validation message "User id is mandatory" is displayed', 'Medium'],
  ['TC-005', 'Payments', 'Pay invoice by card', 'Open invoice, choose card, confirm', 'Payment succeeds, invoice status becomes Paid and a receipt email is sent', 'High'],
  ['TC-006', 'Payments', 'Amount above daily limit', 'Pay an amount greater than the daily limit', 'Payment is rejected with the message "Daily limit exceeded"', 'High'],
  ['TC-007', 'Payments', 'Duplicate payment', 'Submit the same payment twice within 1 minute', 'Second payment is not allowed; user sees a duplicate warning', 'Medium'],
  ['TC-008', 'Reports', 'Export monthly report to PDF', 'Select month, click Export PDF', 'PDF is downloaded with totals matching the on-screen values', 'Low'],
];
rows.forEach((r) => ws.addRow(r));
ws.columns.forEach((c) => { c.width = 28; });

await wb.xlsx.writeFile('sample-testcases.xlsx');
console.log('Wrote sample-testcases.xlsx');
