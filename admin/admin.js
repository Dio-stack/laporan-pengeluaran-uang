// =====================================================
// ADMIN PANEL - LOGIC UTAMA
// =====================================================

'use strict';

/* ════════════════════════════════════════════════════
   KONFIGURASI ADMIN (DARI config.js - EDIT FILE INI)
   Ganti ADMIN_CREDENTIALS dan GEMINI_API_KEY di admin/config.js
══════════════════════════════════════════════════════ */
const adminConfig = window.ADMIN_CONFIG || {};
const supabaseUrl = window.SUPABASE_URL || adminConfig.SUPABASE_URL;
const supabaseKey = window.SUPABASE_ANON_KEY || adminConfig.SUPABASE_KEY;
let adminClient = null;

function getAdminClient() {
  if (!window.supabase?.createClient) {
    throw new Error('Library Supabase belum dimuat. Periksa koneksi internet lalu muat ulang halaman.');
  }
  if (!adminClient) {
    adminClient = window.supabase.createClient(supabaseUrl, supabaseKey);
  }
  return adminClient;
}

/* ════════════════════════════════════════════════════
   SESSION MANAGEMENT
══════════════════════════════════════════════════════ */
async function getAdminSession() {
  const { data: { session }, error } = await getAdminClient().auth.getSession();
  if (error || !session?.user) return null;
  return session;
}

async function isAdminSession(session = null) {
  const currentSession = session || await getAdminSession();
  if (!currentSession?.user) return false;

  const { data, error } = await getAdminClient()
    .from('admins')
    .select('id, username')
    .eq('id', currentSession.user.id)
    .maybeSingle();

  return !error && Boolean(data);
}

async function logout() {
  await getAdminClient().auth.signOut();
  window.location.href = './index.html';
}

/* ════════════════════════════════════════════════════
   AUTHENTICATION
══════════════════════════════════════════════════════ */
async function authenticate(email, password) {
  if (!email || !password) {
    return { success: false, error: 'Email dan password harus diisi.' };
  }

  const { data, error } = await getAdminClient().auth.signInWithPassword({ email, password });
  if (error) {
    return { success: false, error: error.message };
  }

  if (!(await isAdminSession(data.session))) {
    await getAdminClient().auth.signOut();
    return { success: false, error: 'Akun ini belum terdaftar sebagai admin.' };
  }

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

async function initLoginPage() {
  const form = document.getElementById('admin-login-form');
  const errorEl = document.getElementById('admin-error');
  const submitBtn = document.getElementById('admin-submit');

  const existingSession = await getAdminSession();
  if (existingSession && await isAdminSession(existingSession)) {
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
    
    const result = await authenticate(username, password);
    
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
  const session = await getAdminSession();
  if (!session || !(await isAdminSession(session))) {
    await getAdminClient().auth.signOut();
    window.location.href = './index.html';
    return;
  }
  
  // Tampilkan informasi user yang login
  const userEl = document.getElementById('admin-user-info');
  if (userEl) {
    userEl.textContent = `Halo, Admin: ${session.user.email}`;
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
