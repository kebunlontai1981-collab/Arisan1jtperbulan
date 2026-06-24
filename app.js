/* ═══════════════════════════════════════
   app.js — Halaman User (index.html)
   Sistem Arisan Keluarga & Komunitas
═══════════════════════════════════════ */

'use strict';

// ── SUPABASE INIT ──
const { createClient } = window.supabase;
const sb = createClient(
  'https://kzhgmmopruugbnkhyemc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt6aGdtbW9wcnV1Z2Jua2h5ZW1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1ODM0ODEsImV4cCI6MjA5NzE1OTQ4MX0.OQ9wILuiDuan4V3wZGMJ8mVmJvwY9lyC5BmvHHodEM8'
);

// ── STATE ──
let currentUser   = null;
let currentProfile= null;
let currentGroupId= null;
let chatChannel   = null;
let winnerChannel = null;
let compressedBlob = null;
let pendingPaymentId = null;

// ── DOM REFS ──
const $ = id => document.getElementById(id);
const authScreen    = $('auth-screen');
const appEl         = $('app');
const loginForm     = $('login-form');
const authError     = $('auth-error');
const navUsername   = $('nav-username');
const navRole       = $('nav-role');
const navAvatar     = $('nav-avatar');
const sidebar       = $('sidebar');
const toast         = $('toast');

// ═══════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════
function showToast(msg, duration = 2600) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._tid);
  toast._tid = setTimeout(() => toast.classList.remove('show'), duration);
}

function formatRupiah(n) {
  return 'Rp ' + Number(n).toLocaleString('id-ID');
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric'
  });
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'baru saja';
  if (m < 60) return `${m} mnt lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam lalu`;
  return `${Math.floor(h / 24)} hari lalu`;
}

// ── IMAGE COMPRESSION ──
async function compressImage(file, maxKB = 200) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        const maxDim = 1200;
        if (width > maxDim || height > maxDim) {
          if (width > height) { height = (height / width) * maxDim; width = maxDim; }
          else                { width = (width / height) * maxDim; height = maxDim; }
        }
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);

        let quality = 0.85;
        const tryCompress = () => {
          canvas.toBlob(blob => {
            if (blob.size <= maxKB * 1024 || quality < 0.2) {
              resolve(blob);
            } else {
              quality -= 0.1;
              tryCompress();
            }
          }, 'image/jpeg', quality);
        };
        tryCompress();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ═══════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════
loginForm.addEventListener('submit', async e => {
  e.preventDefault();
  authError.textContent = '';
  const loginBtn = $('login-btn');
  loginBtn.disabled = true;
  loginBtn.textContent = 'Memuat...';

  const email = $('login-email').value.trim();
  const pass  = $('login-password').value;

  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
  if (error) {
    authError.textContent = 'Email atau kata sandi salah.';
    loginBtn.disabled = false;
    loginBtn.textContent = 'Masuk';
    return;
  }

  await bootApp(data.user);
});

async function bootApp(user) {
  currentUser = user;

  // Load profile
  const { data: profile } = await sb
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  currentProfile = profile;

  // Redirect admin
  if (profile?.role === 'admin') {
    window.location.href = 'admin.html';
    return;
  }

  // Setup nav
  navUsername.textContent = profile?.username || user.email;
  navRole.textContent     = 'Anggota';
  setAvatar(navAvatar, profile?.avatar_url, profile?.username || '?');

  authScreen.classList.add('hidden');
  appEl.classList.remove('hidden');

  navigateTo('groups');
  subscribeWinnerChannel();
}

async function checkSession() {
  const { data: { session } } = await sb.auth.getSession();
  if (session?.user) {
    await bootApp(session.user);
  }
}

$('logout-btn').addEventListener('click', async () => {
  await sb.auth.signOut();
  location.reload();
});

// ═══════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════
function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const pageEl = $(`page-${page}`);
  if (pageEl) pageEl.classList.remove('hidden');

  const navEl = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navEl) navEl.classList.add('active');

  const titles = {
    groups: 'Grup Arisan',
    payments: 'Iuran Saya',
    history: 'Riwayat',
    'group-detail': 'Detail Grup'
  };
  $('topbar-title').textContent = titles[page] || page;

  sidebar.classList.remove('open');

  if (page === 'groups')   loadGroups();
  if (page === 'payments') loadMyPayments();
  if (page === 'history')  loadHistory();
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => navigateTo(item.dataset.page));
});

$('hamburger').addEventListener('click', () => sidebar.classList.toggle('open'));
$('sidebar-close').addEventListener('click', () => sidebar.classList.remove('open'));

// ═══════════════════════════════════════
//  GROUPS PAGE
// ═══════════════════════════════════════
async function loadGroups() {
  const grid = $('groups-grid');
  grid.innerHTML = '<div class="skeleton-card"></div><div class="skeleton-card"></div>';

  const { data: groups, error } = await sb
    .from('arisan_groups')
    .select(`*, group_members(count)`)
    .order('created_at', { ascending: false });

  if (error || !groups) {
    grid.innerHTML = '<p class="muted">Gagal memuat grup.</p>';
    return;
  }

  // Check membership for current user
  const { data: myMemberships } = await sb
    .from('group_members')
    .select('group_id')
    .eq('user_id', currentUser.id);

  const myGroupIds = new Set((myMemberships || []).map(m => m.group_id));

  grid.innerHTML = groups.map(g => {
    const memberCount = g.group_members?.[0]?.count ?? 0;
    const isMember    = myGroupIds.has(g.id);
    const isFull      = memberCount >= g.max_slots;
    const coverStyle  = g.cover_url
      ? `<img src="${g.cover_url}" alt="${g.name}">`
      : '';

    return `
    <div class="group-card" onclick="openGroupDetail('${g.id}','${g.name}')">
      <div class="group-cover">
        ${coverStyle}
        <span class="group-cover-badge">${memberCount}/${g.max_slots} anggota</span>
      </div>
      <div class="group-body">
        <div class="group-name">${g.name}</div>
        <div class="group-desc">${g.description || 'Grup arisan'}</div>
        <div class="group-meta">
          <span class="group-amount">${formatRupiah(g.monthly_amount)}/bulan</span>
          <span class="group-slots">${g.max_slots - memberCount} slot tersisa</span>
        </div>
        <div class="group-actions">
          ${isMember
            ? `<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openGroupDetail('${g.id}','${g.name}')">💬 Buka Chat</button>`
            : isFull
              ? `<button class="btn btn-ghost btn-sm" disabled>Penuh</button>`
              : `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();joinGroup('${g.id}')">Gabung Grup</button>`
          }
        </div>
      </div>
    </div>`;
  }).join('');
}

async function joinGroup(groupId) {
  const { error } = await sb.from('group_members').insert({
    group_id: groupId,
    user_id:  currentUser.id
  });

  if (error) {
    showToast(error.code === '23505' ? 'Kamu sudah bergabung di grup ini.' : 'Gagal bergabung.');
    return;
  }

  showToast('Berhasil bergabung ke grup! 🎉');
  loadGroups();
}

// ═══════════════════════════════════════
//  GROUP DETAIL + CHAT
// ═══════════════════════════════════════
async function openGroupDetail(groupId, groupName) {
  currentGroupId = groupId;
  navigateTo('group-detail');
  $('chat-group-name').textContent = groupName;

  // Load group info
  const { data: group } = await sb
    .from('arisan_groups')
    .select(`*, group_members(user_id, profiles(username, avatar_url))`)
    .eq('id', groupId)
    .single();

  const panel = $('group-info-panel');
  if (group) {
    const members = group.group_members || [];
    panel.innerHTML = `
      <div class="group-cover" style="height:80px;border-radius:var(--r);overflow:hidden;margin-bottom:.75rem;">
        ${group.cover_url ? `<img src="${group.cover_url}" alt="">` : '<div style="background:linear-gradient(135deg,var(--navy),var(--teal));width:100%;height:100%"></div>'}
      </div>
      <h3 style="font-weight:800;color:var(--navy);margin-bottom:4px">${group.name}</h3>
      <p style="font-size:.8rem;color:var(--ink3);margin-bottom:.75rem">${group.description || ''}</p>
      <div style="font-size:.85rem;font-weight:700;color:var(--teal);margin-bottom:.75rem">${formatRupiah(group.monthly_amount)}/bulan</div>
      <div style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--ink4);margin-bottom:.5rem">Anggota (${members.length}/${group.max_slots})</div>
      <div style="display:flex;flex-direction:column;gap:.4rem">
        ${members.map(m => `
          <div style="display:flex;align-items:center;gap:8px">
            <div class="msg-avatar">
              ${m.profiles?.avatar_url
                ? `<img src="${m.profiles.avatar_url}" alt="">`
                : (m.profiles?.username?.[0] || '?').toUpperCase()}
            </div>
            <span style="font-size:.85rem;font-weight:600">${m.profiles?.username || '—'}</span>
          </div>`).join('')}
      </div>`;
  }

  // Load chat
  await loadChat(groupId);
  subscribeChatChannel(groupId);
}

async function loadChat(groupId) {
  const container = $('chat-messages');
  container.innerHTML = '<div class="chat-empty">Memuat pesan...</div>';

  const { data: msgs } = await sb
    .from('messages')
    .select(`*, profiles(username, avatar_url)`)
    .eq('group_id', groupId)
    .order('created_at', { ascending: true })
    .limit(100);

  if (!msgs || !msgs.length) {
    container.innerHTML = '<div class="chat-empty">Belum ada pesan. Mulai percakapan!</div>';
    return;
  }

  container.innerHTML = msgs.map(m => renderMessage(m)).join('');
  container.scrollTop = container.scrollHeight;
}

function renderMessage(msg) {
  const isOwn   = msg.user_id === currentUser.id;
  const name    = msg.profiles?.username || 'Anggota';
  const avatarSrc = msg.profiles?.avatar_url;
  const initial = name[0].toUpperCase();

  return `
  <div class="chat-msg ${isOwn ? 'own' : ''}" id="msg-${msg.id}">
    <div class="msg-avatar">
      ${avatarSrc ? `<img src="${avatarSrc}" alt="">` : initial}
    </div>
    <div class="msg-bubble">
      ${!isOwn ? `<div class="msg-sender">${name}</div>` : ''}
      <div class="msg-text">${escapeHtml(msg.content)}</div>
      <div class="msg-time">${timeAgo(msg.created_at)}</div>
    </div>
  </div>`;
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function subscribeChatChannel(groupId) {
  if (chatChannel) sb.removeChannel(chatChannel);

  chatChannel = sb
    .channel(`chat-${groupId}-${Date.now()}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: `group_id=eq.${groupId}`
    }, async payload => {
      // Fetch full message with profile
      const { data: msg } = await sb
        .from('messages')
        .select(`*, profiles(username, avatar_url)`)
        .eq('id', payload.new.id)
        .single();

      if (msg) {
        const container = $('chat-messages');
        const empty = container.querySelector('.chat-empty');
        if (empty) empty.remove();
        container.insertAdjacentHTML('beforeend', renderMessage(msg));
        container.scrollTop = container.scrollHeight;
      }
    })
    .on('postgres_changes', {
      event: 'DELETE',
      schema: 'public',
      table: 'messages',
      filter: `group_id=eq.${groupId}`
    }, payload => {
      const el = $(`msg-${payload.old.id}`);
      if (el) el.remove();
    })
    .subscribe();
}

// Send message
$('send-btn').addEventListener('click', sendMessage);
$('chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

async function sendMessage() {
  const input   = $('chat-input');
  const content = input.value.trim();
  if (!content || !currentGroupId) return;

  input.value = '';
  const { error } = await sb.from('messages').insert({
    group_id: currentGroupId,
    user_id:  currentUser.id,
    content
  });

  if (error) {
    showToast('Gagal mengirim pesan.');
    input.value = content;
  }
}

// ═══════════════════════════════════════
//  PAYMENTS PAGE
// ═══════════════════════════════════════
async function loadMyPayments() {
  const list = $('payments-list');
  list.innerHTML = '<p class="muted">Memuat...</p>';

  // Get current user's group memberships with active period payments
  const { data: memberships } = await sb
    .from('group_members')
    .select(`
      group_id,
      arisan_groups(id, name, monthly_amount),
      payments(id, status, receipt_url, period_id, arisan_periods(period_number, start_date))
    `)
    .eq('user_id', currentUser.id);

  if (!memberships?.length) {
    list.innerHTML = '<p class="muted">Kamu belum bergabung ke grup manapun.</p>';
    return;
  }

  list.innerHTML = memberships.map(m => {
    const group    = m.arisan_groups;
    const payments = m.payments || [];

    return payments.map(pay => {
      const statusMap = {
        paid:    ['Lunas ✓', 'status-paid'],
        pending: ['Menunggu Verifikasi ⏳', 'status-pending'],
        unpaid:  ['Belum Bayar', 'status-unpaid'],
      };
      const [label, cls] = statusMap[pay.status] || ['—', ''];

      return `
      <div class="payment-card">
        <div class="payment-info">
          <div class="payment-group">${group?.name || '—'}</div>
          <div class="payment-period">Periode ${pay.arisan_periods?.period_number || '?'} · ${formatDate(pay.arisan_periods?.start_date)}</div>
          <div class="payment-amount">${formatRupiah(group?.monthly_amount || 0)}</div>
        </div>
        <div class="payment-actions">
          <span class="status-badge ${cls}">${label}</span>
          ${pay.status === 'unpaid' || pay.status === 'pending'
            ? `<button class="btn btn-primary btn-sm" onclick="openUploadModal('${pay.id}')">📎 Upload Bukti</button>`
            : pay.receipt_url
              ? `<a href="${pay.receipt_url}" target="_blank" class="btn btn-ghost btn-sm">Lihat Bukti</a>`
              : ''}
        </div>
      </div>`;
    }).join('');
  }).join('');
}

// ── UPLOAD MODAL ──
function openUploadModal(paymentId) {
  pendingPaymentId = paymentId;
  compressedBlob   = null;
  $('upload-preview').classList.add('hidden');
  $('upload-area').style.display = 'block';
  $('payment-modal').classList.remove('hidden');
}

$('payment-modal-close').addEventListener('click', () => $('payment-modal').classList.add('hidden'));
$('cancel-upload').addEventListener('click',       () => $('payment-modal').classList.add('hidden'));

$('receipt-input').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;

  showToast('Mengompres gambar...');
  const blob = await compressImage(file);
  compressedBlob = blob;

  const url  = URL.createObjectURL(blob);
  const kb   = (blob.size / 1024).toFixed(1);
  $('preview-img').src   = url;
  $('upload-size').textContent   = `${kb} KB`;
  $('upload-status').textContent = blob.size < 200 * 1024 ? '✓ Siap diupload' : '⚠ Masih besar';
  $('upload-preview').classList.remove('hidden');
  $('upload-area').style.display = 'none';
});

$('confirm-upload').addEventListener('click', async () => {
  if (!compressedBlob || !pendingPaymentId) return;

  $('confirm-upload').disabled = true;
  $('confirm-upload').textContent = 'Mengupload...';

  const fileName = `receipts/${pendingPaymentId}-${Date.now()}.jpg`;
  const { data: uploadData, error: upErr } = await sb.storage
    .from('receipts')
    .upload(fileName, compressedBlob, { contentType: 'image/jpeg', upsert: true });

  if (upErr) {
    showToast('Gagal upload gambar.');
    $('confirm-upload').disabled = false;
    $('confirm-upload').textContent = 'Upload & Kirim';
    return;
  }

  const { data: { publicUrl } } = sb.storage.from('receipts').getPublicUrl(fileName);

  await sb.from('payments').update({
    receipt_url: publicUrl,
    status:      'pending'
  }).eq('id', pendingPaymentId);

  showToast('Bukti transfer berhasil dikirim! ⏳');
  $('payment-modal').classList.add('hidden');
  $('confirm-upload').disabled = false;
  $('confirm-upload').textContent = 'Upload & Kirim';
  loadMyPayments();
});

// ═══════════════════════════════════════
//  HISTORY PAGE
// ═══════════════════════════════════════
async function loadHistory() {
  const list = $('history-list');
  list.innerHTML = '<p class="muted">Memuat...</p>';

  const { data } = await sb
    .from('arisan_periods')
    .select(`*, arisan_groups(name), profiles!winner_id(username)`)
    .not('winner_id', 'is', null)
    .order('created_at', { ascending: false });

  if (!data?.length) {
    list.innerHTML = '<p class="muted">Belum ada riwayat pengundian.</p>';
    return;
  }

  list.innerHTML = data.map(p => `
    <div class="history-item">
      <div class="trophy">🏆</div>
      <div>
        <div class="history-period">Periode ${p.period_number}</div>
        <div class="history-winner">🎉 ${p.profiles?.username || '—'}</div>
        <div class="history-group">${p.arisan_groups?.name || '—'} · ${formatDate(p.start_date)}</div>
      </div>
    </div>`
  ).join('');
}

// ═══════════════════════════════════════
//  WINNER REALTIME LISTENER
// ═══════════════════════════════════════
function subscribeWinnerChannel() {
  winnerChannel = sb
    .channel('winner-broadcast')
    .on('broadcast', { event: 'winner_announced' }, payload => {
      showWinnerOverlay(payload.payload.winner_name, payload.payload.group_name);
    })
    .subscribe();
}

function showWinnerOverlay(name, groupName) {
  $('winner-name-display').textContent = name;
  $('winner-overlay').classList.remove('hidden');
  spawnConfetti();
  showToast(`🎉 Pemenang arisan ${groupName}: ${name}!`, 5000);
}

function closeWinner() {
  $('winner-overlay').classList.add('hidden');
}
window.closeWinner = closeWinner;

function spawnConfetti() {
  const area   = $('confetti-area');
  const colors = ['#d4a017','#0e7490','#059669','#dc2626','#7c3aed','#f0bb2a'];
  area.innerHTML = '';
  for (let i = 0; i < 40; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-piece';
    el.style.cssText = `
      left: ${Math.random()*100}%;
      background: ${colors[Math.floor(Math.random()*colors.length)]};
      animation-duration: ${1.2 + Math.random()*1.2}s;
      animation-delay: ${Math.random()*0.5}s;
      width: ${6+Math.random()*6}px;
      height: ${6+Math.random()*6}px;
    `;
    area.appendChild(el);
  }
}

function setAvatar(el, url, name) {
  if (url) {
    el.innerHTML = `<img src="${url}" alt="${name}">`;
  } else {
    el.textContent = (name?.[0] || '?').toUpperCase();
  }
}

// ═══════════════════════════════════════
//  INIT
// ═══════════════════════════════════════
checkSession();
