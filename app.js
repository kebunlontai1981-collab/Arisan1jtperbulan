/* ═══════════════════════════════════════
   app.js — Halaman User (index.html)
   Sistem Arisan Keluarga & Komunitas (FIXED)
═══════════════════════════════════════ */

'use strict';

const { createClient } = window.supabase;
const sb = createClient(
  'https://kzhgmmopruugbnkhyemc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt6aGdtbW9wcnV1Z2Jua2h5ZW1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1ODM0ODEsImV4cCI6MjA5NzE1OTQ4MX0.OQ9wILuiDuan4V3wZGMJ8mVmJvwY9lyC5BmvHHodEM8'
);

let currentUser   = null;
let currentProfile= null;
let currentGroupId= null;
let chatChannel   = null;
let winnerChannel = null;
let compressedBlob = null;
let pendingPaymentId = null;

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

function showToast(msg, duration = 2600) {
  if(!toast) return;
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

// ── PROSES AUTENTIKASI LOGIN ──
if(loginForm) {
  loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    if(authError) authError.textContent = '';
    const loginBtn = $('login-btn');
    if(loginBtn) {
      loginBtn.disabled = true;
      loginBtn.textContent = 'Memuat...';
    }

    const email = $('login-email').value.trim();
    const pass  = $('login-password').value;

    const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
    if (error) {
      if(authError) authError.textContent = 'Email atau kata sandi salah.';
      if(loginBtn) {
        loginBtn.disabled = false;
        loginBtn.textContent = 'Masuk';
      }
      return;
    }

    await bootApp(data.user);
  });
}

async function bootApp(user) {
  currentUser = user;

  // Load profile dari tabel profiles
  const { data: profile } = await sb
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  currentProfile = profile;

  // Proteksi Gerbang: Jika terdeteksi admin, belokkan ke halaman admin.html
  if (profile?.role === 'admin') {
    window.location.href = 'admin.html';
    return;
  }

  if(navUsername) navUsername.textContent = profile?.username || user.email;
  if(navRole) navRole.textContent      = 'Anggota';
  if(navAvatar) setAvatar(navAvatar, profile?.avatar_url, profile?.username || '?');

  if(authScreen) authScreen.classList.add('hidden');
  if(appEl) appEl.classList.remove('hidden');

  navigateTo('groups');
  subscribeWinnerChannel();
}

async function checkSession() {
  const { data: { session } } = await sb.auth.getSession();
  if (session?.user) {
    await bootApp(session.user);
  }
}

if($('logout-btn')) {
  $('logout-btn').addEventListener('click', async () => {
    await sb.auth.signOut();
    location.reload();
  });
}

// ── NAVIGASI HALAMAN ──
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
  if($('topbar-title')) $('topbar-title').textContent = titles[page] || page;

  if(sidebar) sidebar.classList.remove('open');

  if (page === 'groups')   loadGroups();
  if (page === 'payments') loadMyPayments();
  if (page === 'history')  loadHistory();
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => navigateTo(item.dataset.page));
});

if($('hamburger')) $('hamburger').addEventListener('click', () => sidebar.classList.toggle('open'));
if($('sidebar-close')) $('sidebar-close').addEventListener('click', () => sidebar.classList.remove('open'));

// ── MEMUAT DAFTAR GRUP ──
async function loadGroups() {
  const grid = $('groups-grid');
  if(!grid) return;
  grid.innerHTML = '<div class="skeleton-card"></div>';

  const { data: groups, error } = await sb
    .from('arisan_groups')
    .select(`*, group_members(count)`)
    .order('created_at', { ascending: false });

  if (error || !groups) {
    grid.innerHTML = '<p class="muted">Gagal memuat grup.</p>';
    return;
  }

  const { data: myMemberships } = await sb
    .from('group_members')
    .select('group_id')
    .eq('user_id', currentUser.id);

  const myGroupIds = new Set((myMemberships || []).map(m => m.group_id));

  grid.innerHTML = groups.map(g => {
    const memberCount = g.group_members?.[0]?.count ?? 0;
    const isMember    = myGroupIds.has(g.id);
    const isFull      = memberCount >= g.max_slots;
    const coverStyle  = g.group_cover_url ? `<img src="${g.group_cover_url}" alt="${g.group_name}">` : '';

    return `
    <div class="group-card" onclick="openGroupDetail('${g.id}','${g.group_name}')">
      <div class="group-cover">
        ${coverStyle}
        <span class="group-cover-badge">${memberCount}/${g.max_slots} anggota</span>
      </div>
      <div class="group-body">
        <div class="group-name">${g.group_name}</div>
        <div class="group-desc">Grup arisan aktif</div>
        <div class="group-meta">
          <span class="group-amount">${formatRupiah(g.contribution_amount)}</span>
          <span class="group-slots">${g.max_slots - memberCount} slot tersisa</span>
        </div>
        <div class="group-actions">
          ${isMember
            ? `<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openGroupDetail('${g.id}','${g.group_name}')">💬 Buka Chat</button>`
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
    showToast(error.code === '23505' ? 'Kamu sudah bergabung.' : 'Gagal bergabung.');
    return;
  }

  showToast('Berhasil bergabung ke grup! 🎉');
  loadGroups();
}

// ── MANAJEMEN CHAT REALTIME ──
async function openGroupDetail(groupId, groupName) {
  currentGroupId = groupId;
  navigateTo('group-detail');
  if($('chat-group-name')) $('chat-group-name').textContent = groupName;

  const { data: group } = await sb
    .from('arisan_groups')
    .select(`*, group_members(user_id, profiles(username, avatar_url))`)
    .eq('id', groupId)
    .single();

  const panel = $('group-info-panel');
  if (group && panel) {
    const members = group.group_members || [];
    panel.innerHTML = `
      <div class="group-cover" style="height:80px;border-radius:8px;overflow:hidden;margin-bottom:.75rem;">
        ${group.group_cover_url ? `<img src="${group.group_cover_url}" alt="">` : '<div style="background:linear-gradient(135deg,#0e7490,#059669);width:100%;height:100%"></div>'}
      </div>
      <h3 style="font-weight:800;margin-bottom:4px">${group.group_name}</h3>
      <div style="font-size:.85rem;font-weight:700;margin-bottom:.75rem">${formatRupiah(group.contribution_amount)}</div>
      <div style="font-size:.75rem;font-weight:700;text-transform:uppercase;margin-bottom:.5rem">Anggota (${members.length}/${group.max_slots})</div>
      <div style="display:flex;flex-direction:column;gap:.4rem">
        ${members.map(m => `
          <div style="display:flex;align-items:center;gap:8px">
            <div class="msg-avatar">${m.profiles?.username?.[0].toUpperCase() || '?'}</div>
            <span style="font-size:.85rem;font-weight:600">${m.profiles?.username || '—'}</span>
          </div>`).join('')}
      </div>`;
  }

  await loadChat(groupId);
  subscribeChatChannel(groupId);
}

async function loadChat(groupId) {
  const container = $('chat-messages');
  if(!container) return;
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
  const escapedText = msg.message_text ? escapeHtml(msg.message_text) : '';

  return `
  <div class="chat-msg ${isOwn ? 'own' : ''}" id="msg-${msg.id}">
    <div class="msg-bubble">
      ${!isOwn ? `<div class="msg-sender">${name}</div>` : ''}
      <div class="msg-text">${escapedText}</div>
      <div class="msg-time">${timeAgo(msg.created_at)}</div>
    </div>
  </div>`;
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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
      const { data: msg } = await sb
        .from('messages')
        .select(`*, profiles(username, avatar_url)`)
        .eq('id', payload.new.id)
        .single();

      if (msg) {
        const container = $('chat-messages');
        if(container) {
          const empty = container.querySelector('.chat-empty');
          if (empty) empty.remove();
          container.insertAdjacentHTML('beforeend', renderMessage(msg));
          container.scrollTop = container.scrollHeight;
        }
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

if($('send-btn')) $('send-btn').addEventListener('click', sendMessage);
if($('chat-input')) {
  $('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
}

async function sendMessage() {
  const input   = $('chat-input');
  const content = input.value.trim();
  if (!content || !currentGroupId) return;

  input.value = '';
  const { error } = await sb.from('messages').insert({
    group_id: currentGroupId,
    user_id:  currentUser.id,
    message_text: content
  });

  if (error) {
    showToast('Gagal mengirim pesan.');
    input.value = content;
  }
}

// ── MANAJEMEN PEMBAYARAN IURAN ──
async function loadMyPayments() {
  const list = $('payments-list');
  if(!list) return;
  list.innerHTML = '<p class="muted">Memuat...</p>';

  const { data: payData } = await sb
    .from('payments')
    .select(`*, arisan_groups(group_name, contribution_amount)`)
    .eq('user_id', currentUser.id);

  if (!payData?.length) {
    list.innerHTML = '<p class="muted">Belum ada tagihan iuran.</p>';
    return;
  }

  list.innerHTML = payData.map(pay => {
    const group = pay.arisan_groups;
    const statusMap = {
      paid:                 ['Lunas ✓', 'status-paid'],
      pending_verification: ['Menunggu Verifikasi ⏳', 'status-pending'],
      unpaid:               ['Belum Bayar', 'status-unpaid'],
    };
    const [label, cls] = statusMap[pay.payment_status] || ['—', ''];

    return `
    <div class="payment-card">
      <div class="payment-info">
        <div class="payment-group">${group?.group_name || '—'}</div>
        <div class="payment-period">Putaran Ke-${pay.round_number}</div>
        <div class="payment-amount">${formatRupiah(group?.contribution_amount || 0)}</div>
      </div>
      <div class="payment-actions">
        <span class="status-badge ${cls}">${label}</span>
        ${pay.payment_status === 'unpaid'
          ? `<button class="btn btn-primary btn-sm" onclick="openUploadModal('${pay.id}')">📎 Upload Bukti</button>`
          : pay.proof_url
            ? `<a href="${pay.proof_url}" target="_blank" class="btn btn-ghost btn-sm">Lihat Bukti</a>`
            : ''}
      </div>
    </div>`;
  }).join('');
}

function openUploadModal(paymentId) {
  pendingPaymentId = paymentId;
  compressedBlob   = null;
  if($('upload-preview')) $('upload-preview').classList.add('hidden');
  if($('upload-area')) $('upload-area').style.display = 'block';
  if($('payment-modal')) $('payment-modal').classList.remove('hidden');
}
window.openUploadModal = openUploadModal;

if($('payment-modal-close')) $('payment-modal-close').addEventListener('click', () => $('payment-modal').classList.add('hidden'));
if($('cancel-upload')) $('cancel-upload').addEventListener('click', () => $('payment-modal').classList.add('hidden'));

if($('receipt-input')) {
  $('receipt-input').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;

    showToast('Mengompres gambar...');
    const blob = await compressImage(file);
    compressedBlob = blob;

    const url  = URL.createObjectURL(blob);
    const kb   = (blob.size / 1024).toFixed(1);
    if($('preview-img')) $('preview-img').src = url;
    if($('upload-size')) $('upload-size').textContent = `${kb} KB`;
    if($('upload-status')) $('upload-status').textContent = '✓ Siap diupload';
    if($('upload-preview')) $('upload-preview').classList.remove('hidden');
    if($('upload-area')) $('upload-area').style.display = 'none';
  });
}

if($('confirm-upload')) {
  $('confirm-upload').addEventListener('click', async () => {
    if (!compressedBlob || !pendingPaymentId) return;

    $('confirm-upload').disabled = true;
    $('confirm-upload').textContent = 'Mengupload...';

    const fileName = `${pendingPaymentId}-${Date.now()}.jpg`;
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
      proof_url: publicUrl,
      payment_status: 'pending_verification'
    }).eq('id', pendingPaymentId);

    showToast('Bukti transfer berhasil dikirim! ⏳');
    $('payment-modal').classList.add('hidden');
    $('confirm-upload').disabled = false;
    $('confirm-upload').textContent = 'Upload & Kirim';
    loadMyPayments();
  });
}

// ── RIWAYAT PEMENANG ──
async function loadHistory() {
  const list = $('history-list');
  if(!list) return;
  list.innerHTML = '<p class="muted">Memuat...</p>';

  const { data } = await sb
    .from('arisan_periods')
    .select(`*, arisan_groups(group_name), profiles!winner_id(username)`)
    .not('winner_id', 'is', null)
    .order('round_number', { ascending: false });

  if (!data?.length) {
    list.innerHTML = '<p class="muted">Belum ada riwayat pengundian.</p>';
    return;
  }

  list.innerHTML = data.map(p => `
    <div class="history-item">
      <div class="trophy">🏆</div>
      <div>
        <div class="history-period">Putaran Ke-${p.round_number}</div>
        <div class="history-winner">🎉 ${p.profiles?.username || '—'}</div>
        <div class="history-group">${p.arisan_groups?.group_name || '—'} · ${formatDate(p.draw_date)}</div>
      </div>
    </div>`
  }).join('');
}

function subscribeWinnerChannel() {
  winnerChannel = sb
    .channel('winner-broadcast')
    .on('broadcast', { event: 'winner_announced' }, payload => {
      showWinnerOverlay(payload.payload.winner_name, payload.payload.group_name);
    })
    .subscribe();
}

function showWinnerOverlay(name, groupName) {
  if($('winner-name-display')) $('winner-name-display').textContent = name;
  if($('winner-overlay')) $('winner-overlay').classList.remove('hidden');
  spawnConfetti();
  showToast(`🎉 Pemenang arisan ${groupName}: ${name}!`, 5000);
}

function closeWinner() {
  if($('winner-overlay')) $('winner-overlay').classList.add('hidden');
}
window.closeWinner = closeWinner;

function spawnConfetti() {
  const area   = $('confetti-area');
  if(!area) return;
  const colors = ['#d4a017','#0e7490','#059669'];
  area.innerHTML = '';
  for (let i = 0; i < 30; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-piece';
    el.style.cssText = `
      left: ${Math.random()*100}%;
      background: ${colors[Math.floor(Math.random()*colors.length)]};
      animation-duration: ${1.2 + Math.random()*1.2}s;
      width: 6px; height: 6px;
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

checkSession();
