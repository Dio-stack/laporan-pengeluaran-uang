// =====================================================
// ADMIN PANEL - LOGIC UTAMA
// =====================================================

'use strict';

/* ════════════════════════════════════════════════════
   KONFIGURASI ADMIN (DARI config.js - EDIT FILE INI)
   Ganti ADMIN_CREDENTIALS dan GEMINI_API_KEY di admin/config.js
══════════════════════════════════════════════════════ */
const adminConfig = window.ADMIN_CONFIG;
let adminClient = null;

function getAdminClient() {
  if (!window.supabase?.createClient) {
    throw new Error('Library Supabase belum dimuat. Periksa koneksi internet lalu muat ulang halaman.');
  }
  if (!adminClient) {
    adminClient = window.supabase.createClient(adminConfig.SUPABASE_URL, adminConfig.SUPABASE_KEY);
  }
  return adminClient;
}

/* ════════════════════════════════════════════════════
   SESSION MANAGEMENT
══════════════════════════════════════════════════════ */
const SESSION_KEY = 'admin_session';
const SESSION_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 hari

function setSession() {
  const session = {
    username: adminConfig.ADMIN_CREDENTIALS.username,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_EXPIRY,
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function getSession() {
  const sessionStr = localStorage.getItem(SESSION_KEY);
  if (!sessionStr) return null;
  
  try {
    const session = JSON.parse(sessionStr);
    
    // Cek apakah session masih valid (belum expired)
    if (Date.now() > session.expiresAt) {
      clearSession();
      return null;
    }
    
    return session;
  } catch {
    return null;
  }
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function isLoggedIn() {
  return getSession() !== null;
}

function logout() {
  clearSession();
  window.location.href = './index.html';
}

/* ════════════════════════════════════════════════════
   AUTHENTICATION
══════════════════════════════════════════════════════ */
function authenticate(username, password) {
  // Validasi input
  if (!username || !password) {
    return { success: false, error: 'Username dan password harus diisi.' };
  }
  
  // Cek credential
  if (username !== adminConfig.ADMIN_CREDENTIALS.username) {
    return { success: false, error: 'Username salah.' };
  }
  
  if (password !== adminConfig.ADMIN_CREDENTIALS.password) {
    return { success: false, error: 'Password salah.' };
  }
  
  // Login berhasil
  setSession();
  return { success: true };
}

/* ════════════════════════════════════════════════════
   DATA FETCHING (Admin Only)
══════════════════════════════════════════════════════ */
async function getAllExpenses() {
  const { data, error } = await getAdminClient()
    .from('expenses')
    .select('*')
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  return data || [];
}

async function getDailyUsage() {
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await getAdminClient()
    .from('ai_usage_logs')
    .select('user_id, tokens_used, model_used, status')
    .eq('request_date', today);
  
  if (error) throw error;
  return data || [];
}

async function getTotalUsers() {
  const { count, error } = await getAdminClient()
    .from('expenses')
    .select('*', { count: 'exact', head: true });
  
  if (error) throw error;
  return count || 0;
}

function calculateLocalQuota(usage) {
  const totalDay = Number(adminConfig.GEMINI_DAILY_TOKEN_LIMIT) || 1000000;
  const usedDay = usage.reduce((sum, log) => sum + (Number(log.tokens_used) || 0), 0);

  return {
    usedDay,
    remainingDay: Math.max(totalDay - usedDay, 0),
    totalDay,
  };
}

/* ════════════════════════════════════════════════════
   PAGE INITIALIZATION
══════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  const pageId = document.body.id || document.querySelector('main')?.id || 'unknown';
  
  if (pageId === 'admin-login') {
    initLoginPage();
  } else {
    initAdminPage();
  }
});

function initLoginPage() {
  const form = document.getElementById('admin-login-form');
  const errorEl = document.getElementById('admin-error');
  const submitBtn = document.getElementById('admin-submit');
  
  if (isLoggedIn()) {
    window.location.href = './dashboard.html';
    return;
  }
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const username = document.getElementById('admin-username').value;
    const password = document.getElementById('admin-password').value;
    
    submitBtn.disabled = true;
    submitBtn.textContent = 'Memproses...';
    errorEl.textContent = '';
    
    const result = authenticate(username, password);
    
    if (result.success) {
      window.location.href = './dashboard.html';
    } else {
      errorEl.textContent = result.error;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Masuk';
    }
  });
}

async function initAdminPage() {
  if (!isLoggedIn()) {
    window.location.href = './index.html';
    return;
  }
  
  // Tampilkan informasi user yang login
  const session = getSession();
  const userEl = document.getElementById('admin-user-info');
  if (userEl) {
    userEl.textContent = `Halo, Admin: ${session.username}`;
  }
  
  // Load data dashboard
  try {
    await loadDashboardData();
  } catch (err) {
    console.error('Failed to load dashboard:', err);
  }
}

async function loadDashboardData() {
  const [expenses, usage, totalUsers] = await Promise.all([
    getAllExpenses(),
    getDailyUsage(),
    getTotalUsers(),
  ]);
  const quota = calculateLocalQuota(usage);
  
  // Kuota total berasal dari limit yang dikonfigurasi; penggunaan dihitung dari log Supabase.
  updateQuotaUI(quota);
  updateUsageUI(usage);
  updateExpensesUI(expenses);
  updateStatsUI(totalUsers);
}

function updateQuotaUI(quota) {
  const used = quota.usedDay;
  const percent = quota.totalDay > 0 ? Math.round((used / quota.totalDay) * 100) : 0;
  
  document.getElementById('quota-used').textContent = formatNumber(used);
  document.getElementById('quota-remaining').textContent = formatNumber(quota.remainingDay);
  document.getElementById('quota-total').textContent = formatNumber(quota.totalDay);
  document.getElementById('quota-percent').textContent = `${percent}%`;
  
  // Update progress bar
  const progressBar = document.getElementById('quota-progress');
  if (progressBar) {
    progressBar.style.width = `${percent}%`;
  }
}

function updateUsageUI(usage) {
  const totalTokens = usage.reduce((sum, log) => sum + (log.tokens_used || 0), 0);
  document.getElementById('usage-tokens-today').textContent = formatNumber(totalTokens);
  document.getElementById('usage-requests-today').textContent = usage.length;
}

function updateExpensesUI(expenses) {
  const tbody = document.getElementById('expenses-table-body');
  tbody.innerHTML = '';
  
  expenses.slice(0, 100).forEach(expense => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${expense.expense_date}</td>
      <td>${escapeHtml(expense.name)}</td>
      <td>${expense.category}</td>
      <td>Rp ${formatCurrency(expense.amount)}</td>
      <td>${new Date(expense.created_at).toLocaleString('id-ID')}</td>
    `;
    tbody.appendChild(row);
  });
}

function updateStatsUI(totalUsers) {
  document.getElementById('total-users').textContent = totalUsers;
}

/* ════════════════════════════════════════════════════
   UTILITY FUNCTIONS
══════════════════════════════════════════════════════ */
function formatNumber(num) {
  return new Intl.NumberFormat('id-ID').format(num);
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(amount);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Expose functions to global scope
window.adminLogout = logout;
