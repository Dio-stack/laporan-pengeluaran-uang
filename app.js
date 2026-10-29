/* =====================================================
   DompetKu — Expense Tracker
   app.js | Logika Utama Aplikasi
===================================================== */

'use strict';

/* ══════════════════════════════════════════
   STATE & KONFIGURASI
══════════════════════════════════════════ */

// Data aplikasi dimuat dari Supabase setelah login berhasil.
// localStorage tetap dipakai sebagai fallback dan sumber migrasi sekali jalan.
let entries = [];
let limit = 0;
let editId = null; // ID data yang sedang di-edit
let supabaseClient = null;
let currentOwner = null;
let isLoadingData = false;

// Bulan aktif berdasarkan filter global (default: bulan ini)
let activeMonth = new Date().toISOString().slice(0, 7); // "YYYY-MM"

/* Palet warna untuk chart per kategori */
const CAT_COLORS = {
  makanan:    '#55b895',
  transport:  '#68a9dc',
  hiburan:    '#e8ad4f',
  belanja:    '#d94b89',
  kesehatan:  '#a78bd4',
  pendidikan: '#58b9c7',
  tagihan:    '#e58e68',
  lainnya:    '#9b8b96',
};

const CAT_EMOJI = {
  makanan:    '🍜',
  transport:  '🚗',
  hiburan:    '🎮',
  belanja:    '🛍️',
  kesehatan:  '💊',
  pendidikan: '📚',
  tagihan:    '⚡',
  lainnya:    '📦',
};

const CAT_LABEL = {
  makanan:    'Makanan & Minuman',
  transport:  'Transportasi',
  hiburan:    'Hiburan',
  belanja:    'Belanja',
  kesehatan:  'Kesehatan',
  pendidikan: 'Pendidikan',
  tagihan:    'Tagihan',
  lainnya:    'Lainnya',
};

const ACCESS_KEY = 'dompetku_access';
const ACCESS_SESSION_KEY = 'dompetku_authenticated';
const PASSKEY_ALGORITHMS = {
  '-7': {
    import: { name: 'ECDSA', namedCurve: 'P-256' },
    verify: { name: 'ECDSA', hash: 'SHA-256' },
  },
  '-257': {
    import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    verify: { name: 'RSASSA-PKCS1-v1_5' },
  },
};

function getAccessConfig() {
  try {
    return JSON.parse(localStorage.getItem(ACCESS_KEY) || 'null');
  } catch {
    return null;
  }
}

function setGateMode(isSetup) {
  const config = getAccessConfig();
  const hasPasskey = Boolean(config?.passkey);
  document.getElementById('gate-copy').textContent = isSetup
    ? 'Atur username dan password untuk masuk ke taman catatanmu.'
    : 'Masuk dulu yuk, taman catatanmu sudah menunggu.';
  document.getElementById('gate-submit').innerHTML = isSetup
    ? 'Simpan & masuk <span aria-hidden="true">♡</span>'
    : 'Masuk ke taman <span aria-hidden="true">♡</span>';
  document.getElementById('gate-submit').hidden = false;
  document.getElementById('gate-username').disabled = false;
  document.getElementById('gate-username').required = true;
  document.getElementById('gate-password').disabled = false;
  document.getElementById('gate-password').required = true;
  document.getElementById('gate-confirm-wrap').hidden = !isSetup;
  document.getElementById('gate-confirm-password').disabled = false;
  document.getElementById('gate-password').autocomplete = isSetup ? 'new-password' : 'current-password';
  document.getElementById('gate-footnote').textContent = isSetup
    ? 'Login ini hanya berlaku di browser dan perangkat ini.'
    : 'Passkey perangkat juga bisa digunakan jika sudah diaktifkan.';
  document.getElementById('gate-form').dataset.mode = isSetup ? 'setup' : 'login';
  document.getElementById('gate-passkey').hidden = isSetup || !hasPasskey;
  document.getElementById('show-recovery').hidden = isSetup || !config?.recovery;
}

function showAccessGate() {
  document.getElementById('access-gate').classList.remove('is-hidden');
  document.getElementById('gate-logout').hidden = true;
}

function openAppGate() {
  document.getElementById('access-gate').classList.add('is-hidden');
  document.getElementById('gate-logout').hidden = false;
  loadSupabaseData();
}

function bytesToHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64Url(bytes) {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function derEcdsaSignatureToRaw(signature) {
  const der = new Uint8Array(signature);
  if (der.length < 8 || der[0] !== 0x30 || der[1] !== der.length - 2
      || der[2] !== 0x02) {
    throw new Error('Format tanda tangan passkey tidak dikenali. Coba daftarkan ulang passkey.');
  }

  const rLength = der[3];
  const rStart = 4;
  const sTag = rStart + rLength;
  if (rLength === 0 || sTag + 2 > der.length || der[sTag] !== 0x02) {
    throw new Error('Format tanda tangan passkey tidak valid. Coba daftarkan ulang passkey.');
  }
  const sLength = der[sTag + 1];
  const sStart = sTag + 2;
  if (sLength === 0 || sStart + sLength !== der.length) {
    throw new Error('Format tanda tangan passkey tidak valid. Coba daftarkan ulang passkey.');
  }

  const raw = new Uint8Array(64);
  const copyInteger = (start, length, targetStart) => {
    let offset = start;
    let valueLength = length;
    while (valueLength > 32 && der[offset] === 0) {
      offset += 1;
      valueLength -= 1;
    }
    if (valueLength > 32) {
      throw new Error('Tanda tangan passkey tidak valid. Coba daftarkan ulang passkey.');
    }
    raw.set(der.subarray(offset, offset + valueLength), targetStart + 32 - valueLength);
  };
  copyInteger(rStart, rLength, 0);
  copyInteger(sStart, sLength, 32);
  return raw;
}

function getPasskeySupportError() {
  if (!window.isSecureContext || !crypto.subtle) {
    return 'Passkey hanya bisa digunakan lewat localhost atau HTTPS.';
  }
  if (!location.hostname) {
    return 'Buka aplikasi lewat localhost atau alamat HTTPS untuk menggunakan passkey.';
  }
  if (!window.PublicKeyCredential || !navigator.credentials) {
    return 'Browser ini belum mendukung passkey. Coba gunakan browser terbaru.';
  }
  return '';
}

function getPasskeyOriginError() {
  const supportError = getPasskeySupportError();
  if (supportError) throw new Error(supportError);
  if (!location.hostname) throw new Error('Buka aplikasi lewat localhost atau alamat HTTPS.');
  return location.hostname;
}

async function validatePasskeyClientData(clientDataJSON, challenge, expectedType) {
  const clientData = JSON.parse(new TextDecoder().decode(clientDataJSON));
  if (clientData.type !== expectedType
      || clientData.challenge !== bytesToBase64Url(challenge)
      || clientData.origin !== location.origin) {
    throw new Error('Verifikasi passkey gagal. Coba lagi.');
  }
  return clientData;
}

function hasPasskeyUserVerification(authenticatorData) {
  return authenticatorData.length >= 37
    && (authenticatorData[32] & 0x05) === 0x05;
}

async function registerPasskey() {
  const status = document.getElementById('passkey-setting-message');
  const button = document.getElementById('passkey-enable');
  button.disabled = true;
  status.textContent = 'Menyiapkan passkey...';

  try {
    const rpId = getPasskeyOriginError();
    const config = getAccessConfig();
    if (!config) throw new Error('Atur password terlebih dahulu sebelum menambahkan passkey.');
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userId = crypto.getRandomValues(new Uint8Array(16));
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { id: rpId, name: "Anggun's Report" },
        user: {
          id: userId,
          name: config.username,
          displayName: config.username,
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          residentKey: 'preferred',
          userVerification: 'required',
        },
        timeout: 60000,
        attestation: 'none',
      },
    });
    if (!credential || typeof credential.response.getPublicKey !== 'function'
        || typeof credential.response.getAuthenticatorData !== 'function') {
      throw new Error('Browser ini belum mendukung penyimpanan passkey yang dibutuhkan. Coba browser terbaru.');
    }

    await validatePasskeyClientData(credential.response.clientDataJSON, challenge, 'webauthn.create');
    const authenticatorData = new Uint8Array(credential.response.getAuthenticatorData());
    if (!hasPasskeyUserVerification(authenticatorData)) {
      throw new Error('Perangkat tidak mengonfirmasi verifikasi biometrik atau kunci layar.');
    }
    const publicKey = credential.response.getPublicKey();
    const algorithm = credential.response.getPublicKeyAlgorithm();
    if (!publicKey || !PASSKEY_ALGORITHMS[String(algorithm)]) {
      throw new Error('Jenis kunci passkey ini belum didukung oleh aplikasi.');
    }

    config.passkey = {
      credentialId: bytesToBase64Url(new Uint8Array(credential.rawId)),
      publicKey: bytesToBase64Url(new Uint8Array(publicKey)),
      algorithm,
      rpId,
      createdAt: new Date().toISOString(),
    };
    localStorage.setItem(ACCESS_KEY, JSON.stringify(config));
    updatePasskeySettings();
    setGateMode(false);
    status.textContent = 'Perangkat berhasil terdaftar dan siap digunakan untuk login.';
    showToast('Perangkat terdaftar', 'Login perangkat berhasil diaktifkan.', 'success');
  } catch (error) {
    status.textContent = error.name === 'NotAllowedError'
      ? 'Pendaftaran dibatalkan. Belum ada perangkat yang ditambahkan.'
      : error.message || 'Passkey gagal diaktifkan.';
  } finally {
    button.disabled = false;
  }
}

async function loginWithPasskey() {
  const error = document.getElementById('gate-error');
  error.textContent = '';
  try {
    const rpId = getPasskeyOriginError();
    const config = getAccessConfig();
    if (!config?.passkey) throw new Error('Passkey belum diaktifkan. Silakan login dengan password.');
    if (config.passkey.rpId !== rpId) {
      throw new Error('Passkey dibuat untuk alamat aplikasi yang berbeda. Gunakan password untuk login.');
    }
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId,
        allowCredentials: [{
          type: 'public-key',
          id: base64UrlToBytes(config.passkey.credentialId),
        }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    if (!assertion) throw new Error('Autentikasi passkey tidak berhasil.');

    await validatePasskeyClientData(assertion.response.clientDataJSON, challenge, 'webauthn.get');
    const authenticatorData = new Uint8Array(assertion.response.authenticatorData);
    if (!hasPasskeyUserVerification(authenticatorData)) {
      throw new Error('Perangkat tidak mengonfirmasi verifikasi biometrik atau kunci layar.');
    }
    const expectedRpHash = new Uint8Array(await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(rpId),
    ));
    if (!expectedRpHash.every((byte, index) => byte === authenticatorData[index])) {
      throw new Error('Passkey tidak cocok dengan alamat aplikasi ini.');
    }
    if (bytesToBase64Url(new Uint8Array(assertion.rawId)) !== config.passkey.credentialId) {
      throw new Error('Passkey tidak dikenal. Silakan gunakan password.');
    }

    const algorithm = PASSKEY_ALGORITHMS[String(config.passkey.algorithm)];
    if (!algorithm) {
      throw new Error('Algoritma passkey ini tidak didukung. Hapus lalu daftarkan passkey kembali.');
    }
    const publicKey = await crypto.subtle.importKey(
      'spki',
      base64UrlToBytes(config.passkey.publicKey),
      algorithm.import,
      false,
      ['verify'],
    );
    const clientDataHash = new Uint8Array(await crypto.subtle.digest(
      'SHA-256',
      assertion.response.clientDataJSON,
    ));
    const signedData = new Uint8Array(authenticatorData.length + clientDataHash.length);
    signedData.set(authenticatorData);
    signedData.set(clientDataHash, authenticatorData.length);
    const signature = algorithm.import.name === 'ECDSA'
      ? derEcdsaSignatureToRaw(assertion.response.signature)
      : assertion.response.signature;
    const verified = await crypto.subtle.verify(
      algorithm.verify,
      publicKey,
      signature,
      signedData,
    );
    if (!verified) {
      throw new Error('Passkey perangkat ini tidak cocok dengan data pendaftaran. Pastikan memakai browser dan alamat website yang sama, atau hapus lalu daftarkan ulang passkey.');
    }

    sessionStorage.setItem(ACCESS_SESSION_KEY, 'true');
    openAppGate();
    showToast('Login berhasil', 'Verifikasi passkey berhasil.', 'success');
  } catch (failure) {
    error.textContent = failure.name === 'NotAllowedError'
      ? 'Passkey dibatalkan atau tidak tersedia. Kamu tetap bisa login dengan password.'
      : failure.message || 'Passkey gagal digunakan. Silakan login dengan password.';
  }
}

function updatePasskeySettings() {
  const hasPasskey = Boolean(getAccessConfig()?.passkey);
  const supportError = getPasskeySupportError();
  const enableButton = document.getElementById('passkey-enable');
  const removeButton = document.getElementById('passkey-remove');
  const status = document.getElementById('passkey-setting-status');
  const details = document.getElementById('passkey-setting-details');
  const message = document.getElementById('passkey-setting-message');
  const actionRow = enableButton.closest('.setting-row');
  enableButton.hidden = hasPasskey;
  enableButton.disabled = Boolean(supportError);
  removeButton.hidden = !hasPasskey;
  actionRow.classList.toggle('has-passkey', hasPasskey);
  status.textContent = hasPasskey ? 'Sudah terdaftar' : 'Belum terdaftar';
  status.dataset.state = hasPasskey ? 'active' : 'inactive';
  details.hidden = !hasPasskey;
  if (supportError && !hasPasskey) {
    message.textContent = supportError;
  }
  if (!supportError && !hasPasskey && !message.textContent) {
    message.textContent = 'Belum ada perangkat yang terdaftar. Tekan “Daftarkan perangkat” untuk mulai.';
  }
  if (hasPasskey) {
    const createdAt = getAccessConfig().passkey.createdAt;
    const createdDate = createdAt
      ? new Date(createdAt).toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short' })
      : 'Tanggal tidak tersedia';
    details.textContent = `Perangkat ini terdaftar sejak ${createdDate}. Data wajah atau sidik jari tidak dibagikan ke website.`;
  }
}

function removePasskey() {
  const config = getAccessConfig();
  if (!config?.passkey) return;
  delete config.passkey;
  localStorage.setItem(ACCESS_KEY, JSON.stringify(config));
  updatePasskeySettings();
  document.getElementById('passkey-setting-message').textContent = 'Pendaftaran perangkat sudah dihapus.';
  setGateMode(false);
  showToast('Pendaftaran dihapus', 'Login perangkat sudah dinonaktifkan.', 'success');
}

async function hashGatePassword(password, salt) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const result = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    salt,
    iterations: 120000,
    hash: 'SHA-256',
  }, key, 256);
  return bytesToHex(new Uint8Array(result));
}

async function verifyGatePassword(password, config) {
  const salt = Uint8Array.from(config.salt.match(/.{2}/g), byte => parseInt(byte, 16));
  return await hashGatePassword(password, salt) === config.verifier;
}

async function verifyRecoveryCode(code, recovery) {
  const salt = Uint8Array.from(recovery.salt.match(/.{2}/g), byte => parseInt(byte, 16));
  return await hashGatePassword(code, salt) === recovery.verifier;
}

async function saveRecoveryCode(event) {
  event.preventDefault();
  const message = document.getElementById('recovery-settings-message');
  const code = document.getElementById('recovery-code-new').value;
  const confirmation = document.getElementById('recovery-code-confirm').value;
  message.textContent = '';

  if (!code) {
    message.textContent = 'Kode pemulihan tidak boleh kosong.';
    return;
  }
  if (code !== confirmation) {
    message.textContent = 'Ulangan kode pemulihan belum cocok.';
    return;
  }

  try {
    if (!crypto.subtle) throw new Error('secure-context');
    const config = getAccessConfig();
    if (!config) throw new Error('Akun belum disiapkan.');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    config.recovery = {
      salt: bytesToHex(salt),
      verifier: await hashGatePassword(code, salt),
    };
    localStorage.setItem(ACCESS_KEY, JSON.stringify(config));
    document.getElementById('recovery-settings-form').reset();
    updateRecoverySettings();
    setGateMode(false);
    message.textContent = 'Kode pemulihan tersimpan. Pastikan kamu sudah menyimpannya di tempat aman.';
    showToast('Kode pemulihan tersimpan', 'Kode dapat digunakan untuk membuat username dan password baru.', 'success');
  } catch (error) {
    message.textContent = error.message === 'secure-context'
      ? 'Kode pemulihan hanya dapat disimpan lewat localhost atau HTTPS.'
      : error.message || 'Kode pemulihan gagal disimpan.';
  }
}

function updateRecoverySettings() {
  const status = document.getElementById('recovery-setting-status');
  status.textContent = getAccessConfig()?.recovery
    ? 'Aktif'
    : 'Belum dibuat';
}

function showRecoveryForm() {
  document.getElementById('gate-form').hidden = true;
  document.getElementById('reset-credentials-form').hidden = true;
  document.getElementById('recovery-code-form').hidden = false;
  document.getElementById('gate-copy').textContent = 'Masukkan kode pemulihan untuk mengatur username dan password baru.';
  document.getElementById('recovery-error').textContent = '';
  document.getElementById('recovery-code-form').reset();
  document.getElementById('recovery-code').focus();
}

function showLoginForm() {
  document.getElementById('recovery-code-form').hidden = true;
  document.getElementById('reset-credentials-form').hidden = true;
  document.getElementById('gate-form').hidden = false;
  document.getElementById('gate-copy').textContent = 'Masuk dulu yuk, taman catatanmu sudah menunggu.';
  document.getElementById('gate-error').textContent = '';
  document.getElementById('reset-error').textContent = '';
}

async function handleRecoveryCodeSubmit(event) {
  event.preventDefault();
  const error = document.getElementById('recovery-error');
  error.textContent = '';
  try {
    if (!crypto.subtle) throw new Error('Pemulihan hanya bisa dilakukan lewat localhost atau HTTPS.');
    const config = getAccessConfig();
    const code = document.getElementById('recovery-code').value;
    if (!config?.recovery || !await verifyRecoveryCode(code, config.recovery)) {
      error.textContent = 'Kode pemulihan tidak cocok.';
      return;
    }
    document.getElementById('recovery-code-form').reset();
    document.getElementById('recovery-code-form').hidden = true;
    document.getElementById('reset-credentials-form').hidden = false;
    document.getElementById('reset-error').textContent = '';
    document.getElementById('recovery-new-username').focus();
    document.getElementById('gate-copy').textContent = 'Kode cocok. Buat username dan password baru.';
  } catch (failure) {
    error.textContent = failure.message || 'Kode pemulihan gagal diverifikasi.';
  }
}

async function handleResetCredentialsSubmit(event) {
  event.preventDefault();
  const error = document.getElementById('reset-error');
  const username = document.getElementById('recovery-new-username').value.trim().toLowerCase();
  const password = document.getElementById('recovery-new-password').value;
  const confirmation = document.getElementById('recovery-confirm-password').value;
  error.textContent = '';

  if (username.length < 3) {
    error.textContent = 'Username minimal 3 karakter.';
    return;
  }
  if (!password) {
    error.textContent = 'Password baru tidak boleh kosong.';
    return;
  }
  if (password !== confirmation) {
    error.textContent = 'Ulangan password baru belum cocok.';
    return;
  }

  try {
    if (!crypto.subtle) throw new Error('Pemulihan hanya bisa dilakukan lewat localhost atau HTTPS.');
    const config = getAccessConfig();
    if (!config?.recovery) throw new Error('Kode pemulihan tidak tersedia. Siapkan ulang dari Pengaturan.');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    config.username = username;
    config.salt = bytesToHex(salt);
    config.verifier = await hashGatePassword(password, salt);
    localStorage.setItem(ACCESS_KEY, JSON.stringify(config));
    document.getElementById('reset-credentials-form').reset();
    updateRecoverySettings();
    sessionStorage.removeItem(ACCESS_SESSION_KEY);
    setGateMode(false);
    document.getElementById('recovery-code-form').hidden = true;
    document.getElementById('reset-credentials-form').hidden = true;
    document.getElementById('gate-form').hidden = false;
    document.getElementById('gate-username').value = username;
    document.getElementById('gate-password').value = '';
    document.getElementById('gate-error').textContent = '';
    document.getElementById('gate-copy').textContent = 'Username dan password berhasil diperbarui. Silakan login seperti biasa.';
    document.getElementById('gate-password').focus();
    showAccessGate();
    showToast('Akun diperbarui', 'Silakan login dengan username dan password baru. Kode pemulihan tetap bisa digunakan.', 'success');
  } catch (failure) {
    error.textContent = failure.message || 'Username dan password baru gagal disimpan.';
  }
}

function togglePasswordVisibility(button) {
  const input = document.getElementById(button.dataset.target);
  const showPassword = input.type === 'password';
  input.type = showPassword ? 'text' : 'password';
  button.setAttribute('aria-label', `${showPassword ? 'Sembunyikan' : 'Tampilkan'} kata sandi`);
  button.title = `${showPassword ? 'Sembunyikan' : 'Tampilkan'} kata sandi`;
  button.querySelector('.icon-eye').hidden = showPassword;
  button.querySelector('.icon-eye-off').hidden = !showPassword;
  button.setAttribute('aria-pressed', String(showPassword));
}

function clearGatePassword() {
  const input = document.getElementById('gate-password');
  const button = document.querySelector('[data-target="gate-password"]');
  input.value = '';
  input.type = 'password';
  input.focus();
  button.setAttribute('aria-label', 'Tampilkan kata sandi');
  button.title = 'Tampilkan kata sandi';
  button.querySelector('.icon-eye').hidden = false;
  button.querySelector('.icon-eye-off').hidden = true;
  button.setAttribute('aria-pressed', 'false');
}

async function handleGateSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const username = document.getElementById('gate-username').value.trim();
  const password = document.getElementById('gate-password').value;
  const error = document.getElementById('gate-error');
  error.textContent = '';

  try {
    if (!crypto.subtle) throw new Error('secure-context');

    if (form.dataset.mode === 'setup') {
      const confirmation = document.getElementById('gate-confirm-password').value;
      if (username.length < 3) {
        error.textContent = 'Username minimal 3 karakter ya.';
        return;
      }
      if (password !== confirmation) {
        error.textContent = 'Ulangi password-nya belum cocok.';
        return;
      }

      const salt = crypto.getRandomValues(new Uint8Array(16));
      const verifier = await hashGatePassword(password, salt);
      localStorage.setItem(ACCESS_KEY, JSON.stringify({
        username: username.toLowerCase(),
        salt: bytesToHex(salt),
        verifier,
      }));
      sessionStorage.setItem(ACCESS_SESSION_KEY, 'true');
      openAppGate();
      return;
    }

    const config = getAccessConfig();
    if (!config || username.toLowerCase() !== config.username) {
      error.textContent = 'Username atau password belum cocok.';
      clearGatePassword();
      return;
    }

    if (!await verifyGatePassword(password, config)) {
      error.textContent = 'Username atau password belum cocok.';
      clearGatePassword();
      return;
    }

    sessionStorage.setItem(ACCESS_SESSION_KEY, 'true');
    openAppGate();
  } catch {
    error.textContent = 'Login perlu dibuka lewat localhost atau HTTPS.';
  }
}

async function changeGatePassword(event) {
  event.preventDefault();
  const message = document.getElementById('password-change-message');
  const currentPassword = document.getElementById('current-password').value;
  const newPassword = document.getElementById('new-password').value;
  const confirmation = document.getElementById('confirm-new-password').value;
  message.textContent = '';

  try {
    if (!crypto.subtle) throw new Error('secure-context');
    const config = getAccessConfig();
    if (!config || !await verifyGatePassword(currentPassword, config)) {
      message.textContent = 'Kata sandi saat ini belum cocok.';
      return;
    }
    if (!newPassword) {
      message.textContent = 'Kata sandi baru tidak boleh kosong.';
      return;
    }
    if (newPassword !== confirmation) {
      message.textContent = 'Ulangan kata sandi baru belum cocok.';
      return;
    }

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const verifier = await hashGatePassword(newPassword, salt);
    localStorage.setItem(ACCESS_KEY, JSON.stringify({
      ...config,
      username: config.username,
      salt: bytesToHex(salt),
      verifier,
    }));
    document.getElementById('change-password-form').reset();
    document.querySelectorAll('#change-password-form .password-toggle').forEach(button => {
      const input = document.getElementById(button.dataset.target);
      input.type = 'password';
      button.setAttribute('aria-label', 'Tampilkan kata sandi');
      button.title = 'Tampilkan kata sandi';
      button.querySelector('.icon-eye').hidden = false;
      button.querySelector('.icon-eye-off').hidden = true;
      button.setAttribute('aria-pressed', 'false');
    });
    sessionStorage.removeItem(ACCESS_SESSION_KEY);
    document.getElementById('gate-form').reset();
    document.getElementById('gate-username').value = config.username;
    document.getElementById('gate-error').textContent = '';
    setGateMode(false);
    document.getElementById('gate-copy').textContent = 'Kata sandi berhasil diubah. Silakan login kembali.';
    showAccessGate();
  } catch {
    message.textContent = 'Kata sandi hanya dapat diubah lewat localhost atau HTTPS.';
  }
}

function logoutFromApp() {
  sessionStorage.removeItem(ACCESS_SESSION_KEY);
  document.getElementById('gate-form').reset();
  document.getElementById('gate-error').textContent = '';
  setGateMode(false);
  showAccessGate();
}

/* Referensi Chart.js instances */
let dashChartInstance = null;
let mainChartInstance = null;
let catChartInstance  = null;

/* ══════════════════════════════════════════
   INISIALISASI
══════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  const accessConfig = getAccessConfig();
  const isSetup = !accessConfig;
  setGateMode(isSetup);
  document.getElementById('gate-form').addEventListener('submit', handleGateSubmit);
  document.getElementById('gate-passkey').addEventListener('click', loginWithPasskey);
  document.getElementById('passkey-enable').addEventListener('click', registerPasskey);
  document.getElementById('passkey-remove').addEventListener('click', removePasskey);
  document.getElementById('show-recovery').addEventListener('click', showRecoveryForm);
  document.getElementById('recovery-back').addEventListener('click', showLoginForm);
  document.getElementById('recovery-code-form').addEventListener('submit', handleRecoveryCodeSubmit);
  document.getElementById('reset-credentials-form').addEventListener('submit', handleResetCredentialsSubmit);
  document.getElementById('recovery-settings-form').addEventListener('submit', saveRecoveryCode);
  document.getElementById('change-password-form').addEventListener('submit', changeGatePassword);
  document.querySelectorAll('.password-toggle').forEach(button => {
    button.addEventListener('click', () => togglePasswordVisibility(button));
  });
  if (accessConfig && sessionStorage.getItem(ACCESS_SESSION_KEY) === 'true') {
    openAppGate();
  } else {
    showAccessGate();
  }
  updatePasskeySettings();
  updateRecoverySettings();

  // Set tanggal default form ke hari ini
  document.getElementById('inp-date').value = todayStr();

  // Set filter bulan global ke bulan ini
  document.getElementById('global-month').value = activeMonth;
  initMonthPicker();

  if (!initSupabase()) {
    entries = JSON.parse(localStorage.getItem('dompetku_entries') || '[]');
    limit = parseFloat(localStorage.getItem('dompetku_limit') || '0');
  }

  // Isi limit jika ada
  if (limit > 0) document.getElementById('limit-input').value = limit;

  // Render semua komponen
  renderAll();

  // Cek batas setelah inisialisasi
  setTimeout(checkLimit, 600);
});

/* ══════════════════════════════════════════
   HELPER FUNGSI UMUM
══════════════════════════════════════════ */

/** Format angka ke Rupiah */
function fmt(n) {
  return 'Rp ' + Math.round(n).toLocaleString('id-ID');
}

/** Tanggal hari ini dalam format YYYY-MM-DD */
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/** Filter entries berdasarkan activeMonth */
function getFiltered() {
  return entries.filter(e => e.date.slice(0, 7) === activeMonth);
}

function isSupabaseConfigured() {
  return Boolean(window.supabase
    && window.SUPABASE_URL
    && window.SUPABASE_ANON_KEY
    && !window.SUPABASE_URL.includes('YOUR_PROJECT_REF')
    && !window.SUPABASE_ANON_KEY.includes('YOUR_SUPABASE_ANON_KEY'));
}

function getCurrentOwner() {
  const config = getAccessConfig();
  return config?.username || null;
}

function initSupabase() {
  if (!isSupabaseConfigured() || supabaseClient) return Boolean(supabaseClient);
  supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  return true;
}

function mapExpense(row) {
  return {
    id: row.id,
    date: row.expense_date,
    name: row.name,
    cat: row.category,
    amount: Number(row.amount),
  };
}

async function loadSupabaseData() {
  if (isLoadingData || !initSupabase()) return;
  if (sessionStorage.getItem(ACCESS_SESSION_KEY) !== 'true') return;

  currentOwner = getCurrentOwner();
  if (!currentOwner) return;
  isLoadingData = true;

  try {
    await migrateLocalEntries();
    const { data, error } = await supabaseClient
      .from('expenses')
      .select('id, expense_date, name, category, amount')
      .eq('owner_key', currentOwner)
      .order('expense_date', { ascending: false });
    if (error) throw error;
    entries = (data || []).map(mapExpense);
    await loadLimit();
    renderAll();
  } catch (error) {
    console.error(error);
    entries = JSON.parse(localStorage.getItem('dompetku_entries') || '[]');
    limit = parseFloat(localStorage.getItem('dompetku_limit') || '0');
    renderAll();
    showToast('Database belum terhubung', error.message || 'Data ditampilkan dari penyimpanan browser.', 'warn');
  } finally {
    isLoadingData = false;
  }
}

async function migrateLocalEntries() {
  const migrationKey = `dompetku_migrated_${currentOwner}`;
  if (localStorage.getItem(migrationKey) === 'true') return;
  const localEntries = JSON.parse(localStorage.getItem('dompetku_entries') || '[]');
  if (localEntries.length > 0) {
    const rows = localEntries.map(entry => ({
      owner_key: currentOwner,
      expense_date: entry.date,
      name: entry.name,
      category: entry.cat,
      amount: Number(entry.amount),
    }));
    const { error } = await supabaseClient.from('expenses').insert(rows);
    if (error) throw error;
  }

  const localLimit = parseFloat(localStorage.getItem('dompetku_limit') || '0');
  if (localLimit > 0) {
    const { error } = await supabaseClient.from('expense_limits').upsert({
      owner_key: currentOwner,
      month_key: activeMonth,
      amount: localLimit,
    }, { onConflict: 'owner_key,month_key' });
    if (error) throw error;
  }

  localStorage.setItem(migrationKey, 'true');
  localStorage.removeItem('dompetku_entries');
  localStorage.removeItem('dompetku_limit');
}

async function loadLimit() {
  const { data, error } = await supabaseClient
    .from('expense_limits')
    .select('amount')
    .eq('owner_key', currentOwner)
    .eq('month_key', activeMonth)
    .maybeSingle();
  if (error) throw error;
  limit = Number(data?.amount || 0);
  document.getElementById('limit-input').value = limit > 0 ? limit : '';
}

/** Fallback lokal lama; dipakai hanya saat Supabase belum dikonfigurasi. */
function saveToStorage() {
  localStorage.setItem('dompetku_entries', JSON.stringify(entries));
}

/** Label bulan yang ramah (cth: "April 2025") */
function monthLabel(ym) {
  if (!ym) return '—';
  const [y, m] = ym.split('-');
  const names = ['Januari','Februari','Maret','April','Mei','Juni',
                 'Juli','Agustus','September','Oktober','November','Desember'];
  return names[parseInt(m) - 1] + ' ' + y;
}

/** Dapatkan jumlah hari dalam bulan activeMonth */
function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}


document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', e => {
    e.preventDefault();
    const target = item.dataset.section;
    goSection(target);
    // Tutup sidebar di mobile setelah klik
    if (window.innerWidth <= 768) closeSidebar();
  });
});

function goSection(name) {
  // Update nav aktif
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navEl = document.querySelector(`.nav-item[data-section="${name}"]`);
  if (navEl) navEl.classList.add('active');

  // Tampilkan section yang dipilih
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  const secEl = document.getElementById('section-' + name);
  if (secEl) secEl.classList.add('active');

  // Update judul topbar
  const titles = { dashboard:'Dashboard', transaksi:'Transaksi', grafik:'Grafik', pengaturan:'Pengaturan' };
  document.getElementById('page-title').textContent = titles[name] || name;

  // Render ulang chart jika berpindah ke section grafik
  if (name === 'grafik') renderCharts();
}

/* ══════════════════════════════════════════
   SIDEBAR (MOBILE)
══════════════════════════════════════════ */

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('overlay').classList.toggle('show');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('overlay').classList.remove('show');
}

/* ══════════════════════════════════════════
   FILTER BULAN GLOBAL
══════════════════════════════════════════ */

async function onMonthChange() {
  const val = document.getElementById('global-month').value;
  if (val) activeMonth = val;
  if (supabaseClient && currentOwner) await loadLimit();
  renderAll();
}

function initMonthPicker() {
  const selector = document.getElementById('month-selector');
  const button = document.getElementById('month-picker-button');
  const label = document.getElementById('month-picker-label');
  const popover = document.getElementById('month-picker-popover');
  const yearLabel = document.getElementById('month-picker-year');
  const grid = document.getElementById('month-picker-grid');
  const hiddenInput = document.getElementById('global-month');
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'];
  let pickerYear = parseInt(activeMonth.slice(0, 4), 10);

  const setPickerOpen = (open) => {
    popover.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) renderPicker();
  };

  const renderPicker = () => {
    yearLabel.textContent = pickerYear;
    grid.replaceChildren();
    monthNames.forEach((name, index) => {
      const monthButton = document.createElement('button');
      const monthValue = `${pickerYear}-${String(index + 1).padStart(2, '0')}`;
      monthButton.type = 'button';
      monthButton.textContent = name;
      monthButton.classList.toggle('selected', monthValue === hiddenInput.value);
      if (monthValue === hiddenInput.value) {
        monthButton.setAttribute('aria-current', 'true');
      }
      monthButton.addEventListener('click', async () => {
        hiddenInput.value = monthValue;
        activeMonth = monthValue;
        label.textContent = monthLabel(monthValue);
        setPickerOpen(false);
        if (supabaseClient && currentOwner) await loadLimit();
        renderAll();
      });
      grid.appendChild(monthButton);
    });
  };

  button.addEventListener('click', () => setPickerOpen(popover.hidden));
  document.getElementById('month-year-prev').addEventListener('click', () => {
    pickerYear--;
    renderPicker();
  });
  document.getElementById('month-year-next').addEventListener('click', () => {
    pickerYear++;
    renderPicker();
  });
  document.getElementById('month-picker-today').addEventListener('click', async () => {
    const currentMonth = new Date().toISOString().slice(0, 7);
    hiddenInput.value = currentMonth;
    activeMonth = currentMonth;
    pickerYear = parseInt(currentMonth.slice(0, 4), 10);
    label.textContent = monthLabel(currentMonth);
    setPickerOpen(false);
    if (supabaseClient && currentOwner) await loadLimit();
    renderAll();
  });

  document.addEventListener('click', (event) => {
    if (!selector.contains(event.target)) setPickerOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !popover.hidden) {
      setPickerOpen(false);
      button.focus();
    }
  });

  hiddenInput.value = activeMonth;
  label.textContent = monthLabel(activeMonth);
  renderPicker();
}

/* ══════════════════════════════════════════
   FORM — SIMPAN & EDIT & HAPUS
══════════════════════════════════════════ */

/**
 * Menyimpan entri baru atau memperbarui entri yang sedang di-edit.
 * Dipanggil saat form disubmit.
 */
async function saveEntry(e) {
  e.preventDefault();

  // Ambil nilai input
  const date   = document.getElementById('inp-date').value.trim();
  const name   = document.getElementById('inp-name').value.trim();
  const cat    = document.getElementById('inp-cat').value;
  const amount = parseFloat(document.getElementById('inp-amount').value);

  // Validasi manual
  let valid = true;

  if (!date) {
    showErr('err-date', 'Tanggal wajib diisi'); valid = false;
  } else clearErr('err-date');

  if (!name) {
    showErr('err-name', 'Nama pengeluaran wajib diisi'); valid = false;
  } else clearErr('err-name');

  if (!cat) {
    showErr('err-cat', 'Pilih kategori'); valid = false;
  } else clearErr('err-cat');

  if (!amount || amount <= 0 || isNaN(amount)) {
    showErr('err-amount', 'Nominal harus berupa angka positif'); valid = false;
  } else clearErr('err-amount');

  if (!valid) return;

  try {
    if (supabaseClient && currentOwner) {
      if (editId !== null) {
        const { error } = await supabaseClient
          .from('expenses')
          .update({ expense_date: date, name, category: cat, amount })
          .eq('id', editId)
          .eq('owner_key', currentOwner);
        if (error) throw error;
      } else {
        const { error } = await supabaseClient.from('expenses').insert({
          owner_key: currentOwner,
          expense_date: date,
          name,
          category: cat,
          amount,
        });
        if (error) throw error;
      }
      await loadSupabaseData(true);
    } else {
      if (editId !== null) {
        const idx = entries.findIndex(en => en.id === editId);
        if (idx > -1) entries[idx] = { id: editId, date, name, cat, amount };
      } else {
        entries.unshift({ id: Date.now(), date, name, cat, amount });
      }
      saveToStorage();
    }
  } catch (error) {
    showToast('Gagal menyimpan', error.message || 'Data belum berhasil disimpan.', 'error');
    return;
  }

  const wasEditing = editId !== null;
  editId = null;
  document.getElementById('form-title').textContent = 'Tambah Pengeluaran';
  document.getElementById('btn-cancel-edit').style.display = 'none';
  document.getElementById('btn-save').innerHTML = '<span class="btn-icon-inner">+</span> Simpan Pengeluaran';
  showToast(wasEditing ? 'Data diperbarui' : 'Tersimpan', `"${name}" berhasil ${wasEditing ? 'diperbarui' : 'ditambahkan'}.`, 'success');

  // Reset form
  resetForm();

  // Render ulang semua komponen
  renderAll();

  // Cek batas pengeluaran
  checkLimit();
}

/** Edit entri — isi ulang form dengan data entri */
function editEntry(id) {
  const entry = entries.find(e => String(e.id) === String(id));
  if (!entry) return;

  editId = id;
  document.getElementById('inp-date').value   = entry.date;
  document.getElementById('inp-name').value   = entry.name;
  document.getElementById('inp-cat').value    = entry.cat;
  document.getElementById('inp-amount').value = entry.amount;

  document.getElementById('form-title').textContent = 'Edit Pengeluaran';
  document.getElementById('btn-cancel-edit').style.display = '';
  document.getElementById('btn-save').innerHTML = '✓ Perbarui Data';

  // Scroll ke form
  goSection('transaksi');
  setTimeout(() => {
    document.getElementById('expense-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

/** Hapus satu entri */
async function deleteEntry(id) {
  const entry = entries.find(e => String(e.id) === String(id));
  if (!entry) return;

  if (!confirm(`Hapus "${entry.name}"? Tindakan ini tidak dapat dibatalkan.`)) return;

  if (supabaseClient && currentOwner) {
    const { error } = await supabaseClient
      .from('expenses')
      .delete()
      .eq('id', id)
      .eq('owner_key', currentOwner);
    if (error) {
      showToast('Gagal menghapus', error.message, 'error');
      return;
    }
    await loadSupabaseData(true);
  } else {
    entries = entries.filter(e => String(e.id) !== String(id));
    saveToStorage();
    renderAll();
  }
  showToast('Dihapus', `"${entry.name}" berhasil dihapus.`, 'error');
}

/** Batalkan mode edit */
function cancelEdit() {
  editId = null;
  resetForm();
  document.getElementById('form-title').textContent = 'Tambah Pengeluaran';
  document.getElementById('btn-cancel-edit').style.display = 'none';
  document.getElementById('btn-save').innerHTML = '<span class="btn-icon-inner">+</span> Simpan Pengeluaran';
}

/** Reset nilai-nilai form */
function resetForm() {
  document.getElementById('inp-date').value   = todayStr();
  document.getElementById('inp-name').value   = '';
  document.getElementById('inp-cat').value    = '';
  document.getElementById('inp-amount').value = '';
  ['err-date','err-name','err-cat','err-amount'].forEach(clearErr);
}

function showErr(id, msg) {
  document.getElementById(id).textContent = msg;
  // Tambahkan class error ke input yang bersangkutan
  const inputId = id.replace('err-', 'inp-');
  const el = document.getElementById(inputId);
  if (el) el.classList.add('error');
}

function clearErr(id) {
  document.getElementById(id).textContent = '';
  const inputId = id.replace('err-', 'inp-');
  const el = document.getElementById(inputId);
  if (el) el.classList.remove('error');
}

/* ══════════════════════════════════════════
   RENDER SEMUA KOMPONEN
══════════════════════════════════════════ */

/** Render ulang seluruh UI */
function renderAll() {
  renderStats();
  renderRecentList();
  renderTable();
  renderDashChart();
  renderCharts();
  updateStorageInfo();
}

/* ── Statistik ── */
function renderStats() {
  const filtered = getFiltered();
  const total    = filtered.reduce((s, e) => s + e.amount, 0);
  const count    = filtered.length;
  const days     = new Set(filtered.map(e => e.date)).size;
  const avg      = days > 0 ? total / days : 0;

  document.getElementById('stat-total').textContent      = fmt(total);
  document.getElementById('stat-count').textContent      = count;
  document.getElementById('stat-avg').textContent        = fmt(avg);
  document.getElementById('stat-month-label').textContent = monthLabel(activeMonth);
  document.getElementById('stat-active-days').textContent = days + ' hari aktif';

  // Update kartu limit jika ada
  const limitCard = document.getElementById('limit-card');
  if (limit > 0) {
    limitCard.style.display = '';
    const pct = Math.min((total / limit) * 100, 999);
    const rem = limit - total;
    document.getElementById('stat-limit-pct').textContent  = pct.toFixed(1) + '%';
    document.getElementById('stat-limit-rem').textContent  =
      rem >= 0 ? 'Sisa: ' + fmt(rem) : 'Lebih: ' + fmt(-rem);
  } else {
    limitCard.style.display = 'none';
  }

  // Update badge chart di dashboard
  document.getElementById('dash-chart-label').textContent = monthLabel(activeMonth);
  document.getElementById('chart-month-badge').textContent = monthLabel(activeMonth);
  document.getElementById('cat-month-badge').textContent   = monthLabel(activeMonth);
  document.getElementById('table-count-badge').textContent = count + ' data';
}

/* ── List Transaksi Terbaru (Dashboard) ── */
function renderRecentList() {
  const filtered = getFiltered();
  const recent   = [...filtered].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const container = document.getElementById('recent-list');

  if (recent.length === 0) {
    container.innerHTML = '<div class="empty-state">Belum ada transaksi bulan ini</div>';
    return;
  }

  container.innerHTML = recent.map(e => `
    <div class="recent-item">
      <div class="recent-icon cat-${e.cat}">${CAT_EMOJI[e.cat] || '📦'}</div>
      <div class="recent-info">
        <div class="recent-name">${escHtml(e.name)}</div>
        <div class="recent-date">${formatDate(e.date)} · ${CAT_LABEL[e.cat] || e.cat}</div>
      </div>
      <div class="recent-amount">${fmt(e.amount)}</div>
    </div>
  `).join('');
}

/* ── Tabel Pengeluaran ── */
function renderTable() {
  const filtered = getFiltered();
  const sorted   = [...filtered].sort((a, b) => b.date.localeCompare(a.date));
  const tbody    = document.getElementById('table-body');
  const emptyEl  = document.getElementById('table-empty');
  const totalRow = document.getElementById('table-total-row');

  if (sorted.length === 0) {
    tbody.innerHTML = '';
    emptyEl.style.display = '';
    totalRow.style.display = 'none';
    return;
  }

  emptyEl.style.display = 'none';
  totalRow.style.display = '';

  // Hitung total
  const total = sorted.reduce((s, e) => s + e.amount, 0);
  document.getElementById('table-total-val').textContent = fmt(total);

  // Isi baris tabel
  tbody.innerHTML = sorted.map(e => `
    <tr>
      <td style="white-space:nowrap;color:var(--text2);font-size:12px">${formatDate(e.date)}</td>
      <td style="max-width:200px">
        <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500">
          ${escHtml(e.name)}
        </div>
      </td>
      <td>
        <span class="cat-badge cat-${e.cat}">
          ${CAT_EMOJI[e.cat] || ''} ${CAT_LABEL[e.cat] || e.cat}
        </span>
      </td>
      <td class="align-right">
        <span class="amount-cell">${fmt(e.amount)}</span>
      </td>
      <td class="align-center" style="white-space:nowrap">
        <button class="tbl-action edit" onclick="editEntry(${e.id})" title="Edit">✏️</button>
        <button class="tbl-action del"  onclick="deleteEntry(${e.id})" title="Hapus">🗑️</button>
      </td>
    </tr>
  `).join('');
}

/* ══════════════════════════════════════════
   GRAFIK — CHART.JS
══════════════════════════════════════════ */

/** Buat data per-hari untuk bulan activeMonth */
function buildDailyData() {
  const total  = daysInMonth(activeMonth);
  const labels = Array.from({ length: total }, (_, i) => i + 1); // [1, 2, ..., 31]
  const data   = new Array(total).fill(0);

  const filtered = getFiltered();
  filtered.forEach(e => {
    const day = parseInt(e.date.split('-')[2], 10) - 1; // index 0-based
    data[day] += e.amount;
  });

  return { labels, data };
}

/** Opsi dasar Chart.js (soft pink theme) */
function chartDefaults() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#fffafd',
        borderColor: '#f0cddd',
        borderWidth: 1,
        titleColor: '#806b79',
        bodyColor: '#493542',
        callbacks: {
          label: ctx => ' ' + fmt(ctx.raw)
        }
      }
    },
    scales: {
      x: {
        grid: { color: 'rgba(128,107,121,0.1)' },
        ticks: { color: '#a48e9b', font: { family: "'JetBrains Mono', monospace", size: 11 } }
      },
      y: {
        grid: { color: 'rgba(128,107,121,0.1)' },
        ticks: {
          color: '#a48e9b',
          font: { family: "'JetBrains Mono', monospace", size: 11 },
          callback: v => v === 0 ? '0' : (v >= 1000000 ? (v/1000000).toFixed(1)+'jt' : (v/1000).toFixed(0)+'rb')
        }
      }
    }
  };
}

/** Chart mini di Dashboard (line chart) */
function renderDashChart() {
  const { labels, data } = buildDailyData();
  const ctx = document.getElementById('dashChart').getContext('2d');

  if (dashChartInstance) dashChartInstance.destroy();

  // Gradient untuk area di bawah garis
  const grad = ctx.createLinearGradient(0, 0, 0, 180);
  grad.addColorStop(0, 'rgba(217,73,134,0.38)');
  grad.addColorStop(1, 'rgba(217,73,134,0)');

  dashChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor:     '#d94b89',
        backgroundColor: grad,
        borderWidth:     2,
        pointRadius:     data.map(v => v > 0 ? 4 : 0),
        pointBackgroundColor: '#ad285f',
        tension:         0.4,
        fill:            true,
      }]
    },
    options: {
      ...chartDefaults(),
      plugins: {
        ...chartDefaults().plugins,
      }
    }
  });
}

/** Chart utama di halaman Grafik (bar chart) */
function renderCharts() {
  renderMainBarChart();
  renderCatDoughnut();
}

function renderMainBarChart() {
  const { labels, data } = buildDailyData();
  const ctx = document.getElementById('mainChart').getContext('2d');

  if (mainChartInstance) mainChartInstance.destroy();

  // Warna bar tergantung nilai (lebih tinggi = lebih terang)
  const maxVal = Math.max(...data, 1);
  const colors = data.map(v => {
    const alpha = 0.3 + (v / maxVal) * 0.7;
    return `rgba(217,73,134,${alpha.toFixed(2)})`;
  });

  mainChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Pengeluaran',
        data,
        backgroundColor: colors,
        borderColor: '#d94b89',
        borderWidth: 1,
        borderRadius: 4,
      }]
    },
    options: {
      ...chartDefaults(),
      plugins: {
        ...chartDefaults().plugins,
        tooltip: {
          ...chartDefaults().plugins.tooltip,
          callbacks: {
            title: ctx => `Tanggal ${ctx[0].label}`,
            label: ctx => ' ' + fmt(ctx.raw)
          }
        }
      }
    }
  });
}

/** Doughnut chart per kategori */
function renderCatDoughnut() {
  const filtered = getFiltered();
  const bycat    = {};

  filtered.forEach(e => {
    bycat[e.cat] = (bycat[e.cat] || 0) + e.amount;
  });

  const cats   = Object.keys(bycat).sort((a, b) => bycat[b] - bycat[a]);
  const vals   = cats.map(c => bycat[c]);
  const colors = cats.map(c => CAT_COLORS[c] || '#94a3b8');
  const total  = vals.reduce((s, v) => s + v, 0);

  const ctx = document.getElementById('catChart').getContext('2d');
  if (catChartInstance) catChartInstance.destroy();

  if (cats.length === 0) {
    // Gambar placeholder jika tidak ada data
    catChartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Tidak ada data'],
        datasets: [{ data: [1], backgroundColor: ['#f5e7ed'], borderWidth: 0 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
    document.getElementById('cat-legend').innerHTML = '<div class="empty-state">Belum ada data</div>';
    return;
  }

  catChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: cats.map(c => CAT_LABEL[c] || c),
      datasets: [{
        data:            vals,
        backgroundColor: colors,
        borderColor:     '#ffffff',
        borderWidth:     3,
        hoverOffset:     6,
      }]
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      cutout:              '65%',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#fffafd',
          borderColor:     '#f0cddd',
          borderWidth:     1,
          callbacks: {
            label: ctx => ' ' + fmt(ctx.raw) + ' (' + ((ctx.raw / total) * 100).toFixed(1) + '%)'
          }
        }
      }
    }
  });

  // Render legend kustom
  const legendEl = document.getElementById('cat-legend');
  legendEl.innerHTML = cats.map(c => `
    <div class="cat-legend-item">
      <div class="legend-dot" style="background:${CAT_COLORS[c] || '#94a3b8'}"></div>
      <span class="legend-name">${CAT_EMOJI[c] || ''} ${CAT_LABEL[c] || c}</span>
      <span class="legend-pct">${((bycat[c] / total) * 100).toFixed(0)}%</span>
    </div>
  `).join('');
}

/* ══════════════════════════════════════════
   MODAL RINGKASAN BULANAN
══════════════════════════════════════════ */

function showSummaryModal() {
  const filtered = getFiltered();
  const total    = filtered.reduce((s, e) => s + e.amount, 0);
  const count    = filtered.length;
  const days     = new Set(filtered.map(e => e.date)).size;
  const avg      = days > 0 ? total / days : 0;

  // Kategori terbesar
  const bycat = {};
  filtered.forEach(e => { bycat[e.cat] = (bycat[e.cat] || 0) + e.amount; });
  const topCat = Object.entries(bycat).sort((a, b) => b[1] - a[1])[0];

  const isOver = limit > 0 && total > limit;

  document.getElementById('modal-title').textContent = 'Ringkasan ' + monthLabel(activeMonth);
  document.getElementById('modal-icon').textContent  = isOver ? '⚠️' : '📊';

  let html = `
    <div class="modal-row highlight">
      <span class="modal-key">Total Pengeluaran</span>
      <span class="modal-val">${fmt(total)}</span>
    </div>
    <div class="modal-row">
      <span class="modal-key">Jumlah Transaksi</span>
      <span class="modal-val">${count}</span>
    </div>
    <div class="modal-row">
      <span class="modal-key">Hari Aktif</span>
      <span class="modal-val">${days} hari</span>
    </div>
    <div class="modal-row">
      <span class="modal-key">Rata-rata / Hari</span>
      <span class="modal-val">${fmt(avg)}</span>
    </div>
  `;

  if (topCat) {
    html += `
      <div class="modal-row">
        <span class="modal-key">Kategori Terbesar</span>
        <span class="modal-val">${CAT_EMOJI[topCat[0]] || ''} ${CAT_LABEL[topCat[0]] || topCat[0]}</span>
      </div>
    `;
  }

  if (limit > 0) {
    const pct = ((total / limit) * 100).toFixed(1);
    const cls = isOver ? 'danger-row' : 'warn-row';
    html += `
      <div class="modal-row ${cls}">
        <span class="modal-key">Batas Pengeluaran</span>
        <span class="modal-val">${fmt(limit)}</span>
      </div>
      <div class="modal-row ${cls}">
        <span class="modal-key">Persentase Batas</span>
        <span class="modal-val">${pct}%${isOver ? ' — MELEBIHI!' : ''}</span>
      </div>
    `;
  }

  document.getElementById('modal-body').innerHTML = html;

  // Tampilkan modal
  document.getElementById('modal-backdrop').classList.add('show');
  document.getElementById('modal-summary').classList.add('show');
}

function closeModal() {
  document.getElementById('modal-backdrop').classList.remove('show');
  document.getElementById('modal-summary').classList.remove('show');
}

/* ══════════════════════════════════════════
   BATAS PENGELUARAN
══════════════════════════════════════════ */

async function saveLimit() {
  const val = parseFloat(document.getElementById('limit-input').value);
  if (!val || val <= 0) {
    showToast('Gagal', 'Masukkan angka positif untuk batas pengeluaran.', 'error');
    return;
  }
  limit = val;
  if (supabaseClient && currentOwner) {
    const { error } = await supabaseClient.from('expense_limits').upsert({
      owner_key: currentOwner,
      month_key: activeMonth,
      amount: val,
    }, { onConflict: 'owner_key,month_key' });
    if (error) {
      showToast('Gagal menyimpan', error.message, 'error');
      return;
    }
  } else {
    localStorage.setItem('dompetku_limit', limit);
  }
  renderAll();
  showToast('Batas Ditetapkan', 'Batas pengeluaran bulanan: ' + fmt(limit), 'success');
  checkLimit();
}

/** Cek apakah pengeluaran melebihi batas; tampilkan peringatan jika ya */
function checkLimit() {
  if (limit <= 0) return;
  const filtered = getFiltered();
  const total    = filtered.reduce((s, e) => s + e.amount, 0);
  if (total > limit) {
    const over = total - limit;
    showToast(
      '⚠️ Batas Terlampaui!',
      `Pengeluaran ${monthLabel(activeMonth)} sebesar ${fmt(total)} melebihi batas ${fmt(limit)}. Selisih: ${fmt(over)}.`,
      'warn'
    );
  }
}

/* ══════════════════════════════════════════
   HAPUS SEMUA DATA
══════════════════════════════════════════ */

async function clearAllData() {
  if (!confirm('PERINGATAN: Semua data pengeluaran akan dihapus permanen. Lanjutkan?')) return;
  if (supabaseClient && currentOwner) {
    const { error } = await supabaseClient
      .from('expenses')
      .delete()
      .eq('owner_key', currentOwner);
    if (error) {
      showToast('Gagal menghapus', error.message, 'error');
      return;
    }
    await loadSupabaseData(true);
  } else {
    entries = [];
    saveToStorage();
    renderAll();
  }
  showToast('Semua Data Dihapus', 'Seluruh data pengeluaran telah dihapus.', 'error');
}

/* ══════════════════════════════════════════
   STORAGE INFO (Sidebar)
══════════════════════════════════════════ */

function updateStorageInfo() {
  const count = entries.length;
  const pct   = Math.min((count / 500) * 100, 100); // anggap max 500 entri = 100%
  document.getElementById('storage-fill').style.width = pct.toFixed(0) + '%';
  document.getElementById('storage-info').textContent = count + ' transaksi tersimpan';
}

/* ══════════════════════════════════════════
   TOAST NOTIFIKASI
══════════════════════════════════════════ */

let toastTimer = null;

/**
 * Tampilkan toast notifikasi
 * @param {string} title - Judul notifikasi
 * @param {string} msg   - Pesan
 * @param {'success'|'warn'|'error'} type - Jenis
 */
function showToast(title, msg, type = 'success') {
  const toast  = document.getElementById('toast');
  const icon   = document.getElementById('toast-icon');
  const titleEl = document.getElementById('toast-title');
  const msgEl  = document.getElementById('toast-msg');

  // Reset class
  toast.className = 'toast';

  if (type === 'warn')  { toast.classList.add('toast-warn');  icon.textContent = '⚠'; }
  else if (type === 'error') { toast.classList.add('toast-error'); icon.textContent = '✕'; }
  else { icon.textContent = '✓'; }

  titleEl.textContent = title;
  msgEl.textContent   = msg;

  toast.classList.add('show');

  // Auto-dismiss setelah 4 detik
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => closeToast(), 4000);
}

function closeToast() {
  document.getElementById('toast').classList.remove('show');
}

/* ══════════════════════════════════════════
   UTILITAS
══════════════════════════════════════════ */

/** Format tanggal YYYY-MM-DD ke DD/MM/YYYY */
function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

/** Escape HTML untuk mencegah XSS */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
