/**
 * House Loan Calculator
 * Supports: Equal-Payment (本息均攤) & Equal-Principal (本金均攤)
 */

'use strict';

// ─── Formatters ──────────────────────────────────────────────────────────────

function formatCurrency(value) {
  return 'NT$ ' + Math.round(value).toLocaleString('zh-TW');
}

function formatAmount(value) {
  if (value >= 1e8) return (value / 1e8).toFixed(2) + ' 億';
  if (value >= 1e4) return (value / 1e4).toFixed(1) + ' 萬';
  return value.toLocaleString('zh-TW');
}

// ─── Calculation Core ─────────────────────────────────────────────────────────

/**
 * Equal-Payment (本息均攤) amortization
 * Monthly formula: P * r / (1 - (1+r)^-n)
 */
function calcEqualPayment(principal, annualRate, months) {
  const schedule = [];

  if (annualRate === 0) {
    // Zero-rate edge case
    const monthlyPayment = principal / months;
    let balance = principal;
    for (let m = 1; m <= months; m++) {
      balance -= monthlyPayment;
      schedule.push({ month: m, payment: monthlyPayment, principal: monthlyPayment, interest: 0, balance: Math.max(0, balance) });
    }
    return schedule;
  }

  const r = annualRate / 100 / 12;
  const monthlyPayment = principal * r / (1 - Math.pow(1 + r, -months));
  let balance = principal;

  for (let m = 1; m <= months; m++) {
    const interest = balance * r;
    const principalPaid = monthlyPayment - interest;
    balance -= principalPaid;
    schedule.push({
      month: m,
      payment: monthlyPayment,
      principal: principalPaid,
      interest,
      balance: Math.max(0, balance),
    });
  }
  return schedule;
}

/**
 * Equal-Principal (本金均攤) amortization
 * Monthly principal: P / n, interest decreases each month
 */
function calcEqualPrincipal(principal, annualRate, months) {
  const schedule = [];
  const r = annualRate / 100 / 12;
  const monthlyPrincipal = principal / months;
  let balance = principal;

  for (let m = 1; m <= months; m++) {
    const interest = balance * r;
    const payment = monthlyPrincipal + interest;
    balance -= monthlyPrincipal;
    schedule.push({
      month: m,
      payment,
      principal: monthlyPrincipal,
      interest,
      balance: Math.max(0, balance),
    });
  }
  return schedule;
}

// ─── DOM Helpers ──────────────────────────────────────────────────────────────

function el(id) { return document.getElementById(id); }

function showResults() {
  const section = el('resultsSection');
  section.hidden = false;
}

function buildAmortTable(schedule) {
  const tbody = el('amortBody');
  tbody.innerHTML = '';

  schedule.forEach((row, i) => {
    const tr = document.createElement('tr');
    const month = row.month;
    const isYearStart = month > 1 && ((month - 1) % 12 === 0);
    if (isYearStart) tr.classList.add('year-start');

    // Period number (with year badge if first month of year)
    const yearNum = Math.ceil(month / 12);
    const periodCell = isYearStart
      ? `<span class="year-badge">第 ${yearNum} 年</span>`
      : `<span class="period-num">${month}</span>`;

    tr.innerHTML = `
      <td>${periodCell}</td>
      <td>${formatCurrency(row.payment)}</td>
      <td>${formatCurrency(row.principal)}</td>
      <td class="interest-cell">${formatCurrency(row.interest)}</td>
      <td class="balance-cell">${formatCurrency(row.balance)}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ─── Main Calculate Function ──────────────────────────────────────────────────

function calculate() {
  const principal = parseFloat(el('loanAmount').value);
  const annualRate = parseFloat(el('annualRate').value);
  const years = parseFloat(el('loanYears').value);
  const repayType = document.querySelector('input[name="repayType"]:checked').value;

  // Validation
  if (!principal || principal <= 0 || isNaN(principal)) {
    alert('請輸入正確的貸款金額');
    el('loanAmount').focus();
    return;
  }
  if (annualRate < 0 || isNaN(annualRate)) {
    alert('請輸入正確的年利率');
    el('annualRate').focus();
    return;
  }
  if (!years || years < 1 || years > 40 || isNaN(years)) {
    alert('請輸入 1–40 年的貸款年限');
    el('loanYears').focus();
    return;
  }

  const months = Math.round(years * 12);

  // Calculate schedule
  const schedule = repayType === 'equal-payment'
    ? calcEqualPayment(principal, annualRate, months)
    : calcEqualPrincipal(principal, annualRate, months);

  const totalPayment = schedule.reduce((s, r) => s + r.payment, 0);
  const totalInterest = totalPayment - principal;

  const principalPct = Math.round(principal / totalPayment * 100);
  const interestPct = 100 - principalPct;

  // ─── Update Summary Cards ───
  const firstPayment = schedule[0].payment;
  const lastPayment = schedule[schedule.length - 1].payment;

  el('monthlyPayment').textContent = formatCurrency(firstPayment);

  if (repayType === 'equal-payment') {
    el('monthlyPaymentSub').textContent = '每月固定金額';
  } else {
    el('monthlyPaymentSub').textContent = `首月 / 末月 ${formatCurrency(lastPayment)}`;
  }

  el('totalInterest').textContent = formatCurrency(totalInterest);
  el('totalPayment').textContent = formatCurrency(totalPayment);

  // ─── Breakdown Bar ───
  el('principalPct').textContent = principalPct + '%';
  el('interestPct').textContent = interestPct + '%';
  el('barPrincipal').style.width = principalPct + '%';

  // ─── Amortization Table ───
  buildAmortTable(schedule);

  // ─── Amount hint ───
  el('amountHint').textContent = formatAmount(principal) + ' 元';

  // ─── Show results ───
  showResults();

  // Scroll to results smoothly
  setTimeout(() => {
    el('resultsSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 80);
}

// ─── Toggle Amortization Table ────────────────────────────────────────────────

function setupToggle() {
  const btn = el('toggleAmort');
  const wrapper = el('amortWrapper');

  btn.addEventListener('click', () => {
    const isHidden = wrapper.hidden;
    wrapper.hidden = !isHidden;
    btn.textContent = isHidden ? '收合明細' : '展開明細';
    btn.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
    if (isHidden) {
      setTimeout(() => wrapper.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
    }
  });
}

// ─── Live Hint on Amount Input ────────────────────────────────────────────────

function setupAmountHint() {
  el('loanAmount').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    el('amountHint').textContent = v > 0 ? formatAmount(v) + ' 元' : '';
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  el('calcBtn').addEventListener('click', calculate);

  // Allow Enter key on inputs
  document.querySelectorAll('input[type="number"]').forEach(input => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') calculate();
    });
  });

  setupToggle();
  setupAmountHint();

  // Trigger initial calculation with default values
  calculate();
});
