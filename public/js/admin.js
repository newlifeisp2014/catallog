/* ============================================================
   NewLife — admin.js  (Admin dashboard)
   ============================================================ */

// ── Auth ──────────────────────────────────────────────────────
let token = localStorage.getItem('nl_admin_token');
if (!token) window.location.href = '/login.html';

// ── State ─────────────────────────────────────────────────────
let allGames     = [];
let allOrders    = [];
let allCustomers = [];
let currentTab   = 'dashboard';
let orderFilter  = 'all';

// ── Fetch Interceptor (JWT) ───────────────────────────────────
const _fetch = window.fetch;
window.fetch = async function(...args) {
  let [url, cfg] = args;
  if (typeof url === 'string' && url.startsWith('/api/') && !url.includes('/auth/')) {
    cfg = cfg || {};
    cfg.headers = cfg.headers || {};
    cfg.headers['Authorization'] = 'Bearer ' + token;
  }
  const res = await _fetch(url, cfg);
  if (res.status === 401 || res.status === 403) {
    localStorage.removeItem('nl_admin_token');
    window.location.href = '/login.html';
  }
  return res;
};

// ── Tab Switching ─────────────────────────────────────────────
function switchTab(tabId, el) {
  // Nav items
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');

  // Content sections
  document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
  const section = document.getElementById(tabId + 'Tab');
  if (section) section.classList.add('active');

  // Header
  const titles = {
    dashboard: 'لوحة القيادة',
    orders:    'الطلبات',
    games:     'إدارة الألعاب',
    customers: 'الزبائن'
  };
  document.getElementById('pageTitle').textContent = titles[tabId] || tabId;

  const addBtn = document.getElementById('addGameBtn');
  if (addBtn) addBtn.style.display = tabId === 'games' ? 'flex' : 'none';

  currentTab = tabId;
  loadData();
  closeSidebar();
}

// ── Load Data ─────────────────────────────────────────────────
async function loadData() {
  try {
    const promises = [];

    if (['dashboard', 'games'].includes(currentTab)) {
      promises.push(
        fetch('/api/games?limit=2000').then(r => r.json()).then(d => {
          allGames = d.data || [];
          if (currentTab === 'games') renderGames();
        })
      );
    }

    if (['dashboard', 'orders'].includes(currentTab)) {
      promises.push(
        fetch('/api/orders').then(r => r.json()).then(d => {
          allOrders = d.data || d.orders || d || [];
          if (currentTab === 'orders') renderOrders();
        })
      );
    }

    if (['dashboard', 'customers'].includes(currentTab)) {
      promises.push(
        fetch('/api/customers').then(r => r.json()).then(d => {
          allCustomers = d.data || d || [];
          if (currentTab === 'customers') renderCustomers();
        })
      );
    }

    await Promise.all(promises);

    if (currentTab === 'dashboard') {
      updateDashboardStats();
      renderRecentOrders();
    }

  } catch (e) {
    console.error('[Admin] loadData error', e);
    showToast('خطأ في جلب البيانات', 'error');
  }
}

// ── Dashboard Stats ───────────────────────────────────────────
function updateDashboardStats() {
  const pending   = allOrders.filter(o => o.status === 'pending').length;
  const completed = allOrders.filter(o => o.status === 'delivered').length;

  setEl('statGames',           allGames.length);
  setEl('statPendingOrders',   pending);
  setEl('statCompletedOrders', completed);
  setEl('statCustomers',       allCustomers.length);

  // Pending badge on nav
  const badge = document.getElementById('pendingBadge');
  if (badge) {
    badge.textContent = pending;
    badge.style.display = pending > 0 ? 'inline-flex' : 'none';
  }
}

function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ── Recent Orders (Dashboard) ─────────────────────────────────
function renderRecentOrders() {
  const tbody = document.getElementById('recentOrdersBody');
  if (!tbody) return;

  const recent = [...allOrders]
    .sort((a, b) => new Date(b.created_at || b.date) - new Date(a.created_at || a.date))
    .slice(0, 8);

  if (recent.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--clr-text-muted);">لا توجد طلبات حتى الآن</td></tr>`;
    return;
  }

  tbody.innerHTML = recent.map(o => orderRow(o, false)).join('');
}

// ── Orders Table ──────────────────────────────────────────────
let ordersSearchQ = '';

function renderOrders() {
  const tbody = document.getElementById('ordersTableBody');
  if (!tbody) return;

  const q = ordersSearchQ.toLowerCase();
  const filtered = allOrders.filter(o => {
    const matchStatus = orderFilter === 'all' || o.status === orderFilter;
    const matchSearch = !q ||
      (o.customer_name || '').toLowerCase().includes(q) ||
      (o.customer_phone || '').includes(q) ||
      (o.order_id || o.id || '').toLowerCase().includes(q);
    return matchStatus && matchSearch;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--clr-text-muted);">لا توجد نتائج</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .sort((a, b) => new Date(b.created_at || b.date) - new Date(a.created_at || a.date))
    .map(o => orderRow(o, true))
    .join('');
}

function orderRow(o, showActions) {
  const id            = o.orderId || o.order_id || o.id;
  const customerName  = o.customerName || o.customer_name || 'زبون';
  const customerPhone = o.customerPhone || o.customer_phone || '';
  const totalPrice    = parseFloat(o.totalPrice || o.total_price || o.total || 0);
  const status        = o.status || 'pending';
  const s             = STATUS_MAP[status] || STATUS_MAP.pending;
  const dateObj       = new Date(o.createdAt || o.created_at || o.date);
  const date          = isNaN(dateObj.getTime()) ? 'اليوم' : dateObj.toLocaleDateString('ar-IQ');

  return `<tr>
    <td class="td-id">#${id}</td>
    <td class="td-customer"><strong>${customerName}</strong><small>${customerPhone}</small></td>
    <td style="color:var(--clr-text-muted);font-size:0.82rem;">${date}</td>
    <td class="td-amount">${totalPrice.toLocaleString()} <span style="font-size:0.72rem;font-weight:500;">دينار</span></td>
    <td><span class="badge ${s.cls}">${s.label}</span></td>
    ${showActions ? `<td class="td-actions">
      <div style="display:flex;gap:0.35rem;align-items:center;">
        <button class="btn btn-ghost btn-sm" onclick="viewOrder('${id}')" title="عرض التفاصيل والتعديل">
          <i class="fas fa-eye"></i>
        </button>
        <button class="btn btn-sm" style="background:#25D366;color:white;border:none;padding:0.35rem 0.6rem;border-radius:var(--radius-sm);" onclick="sendWhatsAppNotification('${id}')" title="إرسال رسالة واتساب للزبون">
          <i class="fab fa-whatsapp"></i>
        </button>
      </div>
    </td>` : ''}
  </tr>`;
}

function filterOrders(q) {
  ordersSearchQ = q;
  renderOrders();
}

function setOrderFilter(status, el) {
  orderFilter = status;
  document.querySelectorAll('[data-status]').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  renderOrders();
}

const STATUS_MAP = {
  pending:   { label: 'قيد الانتظار', cls: 'badge-pending' },
  confirmed: { label: 'مؤكد',         cls: 'badge-confirmed' },
  delivered: { label: 'مكتمل',        cls: 'badge-delivered' },
  cancelled: { label: 'ملغي',         cls: 'badge-cancelled' }
};

// ── View & Edit Order Modal ──────────────────────────────────
function viewOrder(id) {
  const o = allOrders.find(x => (x.orderId || x.order_id || x.id) === id);
  if (!o) return;

  const orderId       = o.orderId || o.order_id || o.id;
  const customerName  = o.customerName || o.customer_name || 'زبون';
  const customerPhone = o.customerPhone || o.customer_phone || '';
  const totalPrice    = parseFloat(o.totalPrice || o.total_price || o.total || 0);
  const status        = o.status || 'pending';
  const s             = STATUS_MAP[status] || STATUS_MAP.pending;

  document.getElementById('orderModalId').textContent = '#' + orderId;

  const completedGames = o.completedGames || o.completed_games || [];
  const totalGames     = (o.games || []).length;
  const completedCount = (o.games || []).filter(g => completedGames.includes(g.id || g.name || g.nameAr)).length;
  const progressPct    = totalGames > 0 ? Math.round((completedCount / totalGames) * 100) : 0;

  const content = `
    <div class="order-detail-section">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <h4>معلومات الزبون</h4>
        <button class="btn btn-ghost btn-sm" onclick="editOrderModal('${orderId}')" style="color:var(--clr-gold);font-size:0.8rem;">
          <i class="fas fa-edit"></i> تعديل بيانات الطلب
        </button>
      </div>
      <div style="display:flex;flex-direction:column;gap:0.5rem;font-size:0.9rem;margin-top:0.5rem;">
        <div><i class="fas fa-user" style="color:var(--clr-primary-light);width:18px;margin-left:6px;"></i><strong>الاسم:</strong> ${customerName}</div>
        <div><i class="fas fa-phone" style="color:var(--clr-primary-light);width:18px;margin-left:6px;"></i><strong>الهاتف:</strong> ${customerPhone}</div>
        <div style="margin-top:0.25rem;"><strong>الحالة:</strong> <span class="badge ${s.cls}" style="margin-right:0.3rem;">${s.label}</span></div>
      </div>
    </div>

    <div class="order-detail-section">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.6rem;">
        <h4 style="margin:0;">تحديد الألعاب المنجزة (${completedCount} / ${totalGames})</h4>
        <span style="font-size:0.8rem;font-weight:700;color:var(--clr-gold);">${progressPct}% مكتمل</span>
      </div>
      
      <!-- Progress Bar -->
      <div style="width:100%;height:8px;background:var(--clr-surface-2);border-radius:10px;overflow:hidden;margin-bottom:0.8rem;">
        <div style="width:${progressPct}%;height:100%;background:linear-gradient(90deg, #7c3aed, #f59e0b);transition:width 0.3s ease;"></div>
      </div>

      <div style="display:flex;flex-direction:column;gap:0.4rem;">
        ${(o.games || []).map(g => {
          const gId   = g.id || g.name || g.nameAr;
          const isDone = completedGames.includes(gId);
          return `
            <div class="order-game-item" style="display:flex;align-items:center;justify-content:space-between;padding:0.65rem 0.8rem;background:var(--clr-surface-2);border-radius:var(--radius-md);border:1px solid ${isDone ? 'rgba(34,197,94,0.3)' : 'var(--clr-border-light)'};">
              <label style="display:flex;align-items:center;gap:0.6rem;cursor:pointer;flex:1;margin:0;">
                <input
                  type="checkbox"
                  ${isDone ? 'checked' : ''}
                  onchange="toggleGameCompleted('${orderId}', '${gId.replace(/'/g, "\\'")}', this.checked)"
                  style="width:18px;height:18px;cursor:pointer;accent-color:var(--clr-gold);"
                >
                <span style="font-size:0.92rem;font-weight:${isDone ? '700' : '500'};color:${isDone ? 'var(--clr-success)' : 'var(--clr-text)'};text-decoration:${isDone ? 'line-through' : 'none'};">
                  ${g.name_ar || g.nameAr || g.name}
                </span>
              </label>
              <span class="order-game-item__hdd" style="font-size:0.75rem;padding:0.2rem 0.5rem;background:rgba(255,255,255,0.05);border-radius:var(--radius-sm);">هارد ${g.hardDrive || '1'}</span>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <div class="order-detail-section" style="background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.15);">
      <h4>المجموع الكلي</h4>
      <div style="font-size:1.35rem;font-weight:800;color:var(--clr-gold);">
        ${totalPrice.toLocaleString()} دينار
      </div>
    </div>

    ${o.notes ? `<div class="order-detail-section">
      <h4>الملاحظات</h4>
      <p style="font-size:0.88rem;color:var(--clr-text-muted);">${o.notes}</p>
    </div>` : ''}
  `;

  document.getElementById('orderDetailsContent').innerHTML = content;

  // Actions
  let actions = `<button class="btn btn-ghost" onclick="closeOrderModal()">إغلاق</button>`;
  actions += `
    <button class="btn" style="background:#25D366;color:white;font-weight:700;" onclick="sendWhatsAppNotification('${orderId}')">
      <i class="fab fa-whatsapp"></i> إرسال واتساب
    </button>`;

  if (status === 'pending') {
    actions += `
      <button class="btn btn-primary" style="flex:1;" onclick="updateOrderStatus('${orderId}','confirmed')">
        <i class="fas fa-check"></i> تأكيد الطلب
      </button>
      <button class="btn btn-danger" onclick="updateOrderStatus('${orderId}','cancelled')">
        <i class="fas fa-times"></i> إلغاء
      </button>`;
  } else if (status === 'confirmed') {
    actions += `
      <button class="btn btn-primary" style="flex:1;" onclick="updateOrderStatus('${orderId}','delivered')">
        <i class="fas fa-flag-checkered"></i> تم التثبيت والتسليم
      </button>`;
  }

  // Delete button always visible to admin
  actions += `
    <button class="btn btn-danger" onclick="deleteOrder('${orderId}')" title="حذف الطلب نهائياً" style="margin-top:0.25rem;width:100%;">
      <i class="fas fa-trash-alt"></i> حذف الطلب نهائياً
    </button>`;

  document.getElementById('orderModalActions').innerHTML = actions;
  document.getElementById('orderModal').classList.add('active');
}

// ── Delete Order ──────────────────────────────────────────────
async function deleteOrder(orderId) {
  if (!confirm(`هل أنت متأكد من حذف الطلب #${orderId} نهائياً؟\nلا يمكن التراجع عن هذا الإجراء!`)) return;

  try {
    const token = localStorage.getItem('nl_admin_token');
    const res = await fetch(`/api/orders/${orderId}`, {
      method:  'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error();
    showToast('تم حذف الطلب بنجاح 🗑️');
    closeOrderModal();
    allOrders = allOrders.filter(o => (o.orderId || o.order_id || o.id) !== orderId);
    renderOrders();
  } catch {
    showToast('فشل حذف الطلب', 'error');
  }
}

async function toggleGameCompleted(orderId, gameId, isChecked) {
  const o = allOrders.find(x => (x.orderId || x.order_id || x.id) === orderId);
  if (!o) return;

  let completedGames = [...(o.completedGames || o.completed_games || [])];
  if (isChecked) {
    if (!completedGames.includes(gameId)) completedGames.push(gameId);
  } else {
    completedGames = completedGames.filter(id => id !== gameId);
  }

  o.completedGames = completedGames;
  o.completed_games = completedGames;

  try {
    const res = await fetch(`/api/orders/${orderId}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ completedGames })
    });
    if (!res.ok) throw new Error();
    
    const totalGames = (o.games || []).length;
    if (completedGames.length === totalGames && totalGames > 0) {
      showToast('🎉 تم تثبيت وإنجاز جميع ألعاب الطلب!');
      if (confirm('تهانينا! تم إنجاز جميع الألعاب. هل تريد تحويل حالة الطلب إلى "مكتمل" وإرسال رسالة إشعار للزبون عبر الواتساب؟')) {
        updateOrderStatus(orderId, 'delivered');
      } else {
        viewOrder(orderId);
      }
    } else {
      showToast(isChecked ? 'تم تحديد اللعبة كـ مكتملة ✅' : 'تم إلغاء تحديد اللعبة');
      viewOrder(orderId);
    }
  } catch (e) {
    showToast('فشل حفظ حالة الإنجاز', 'error');
  }
}

function editOrderModal(id) {
  const o = allOrders.find(x => (x.orderId || x.order_id || x.id) === id);
  if (!o) return;

  const currentName  = o.customerName || o.customer_name || '';
  const currentPhone = o.customerPhone || o.customer_phone || '';
  const currentNotes = o.notes || '';
  const currentTotal = parseFloat(o.totalPrice || o.total_price || o.total || 0);

  const newName = prompt('تعديل اسم الزبون:', currentName);
  if (newName === null) return;

  const newPhone = prompt('تعديل رقم الهاتف:', currentPhone);
  if (newPhone === null) return;

  const newNotes = prompt('تعديل الملاحظات:', currentNotes);
  if (newNotes === null) return;

  const newTotalStr = prompt('تعديل المبلغ الكلي (دينار):', currentTotal);
  if (newTotalStr === null) return;
  const newTotal = parseFloat(newTotalStr) || currentTotal;

  updateOrderData(id, {
    customerName:  newName.trim() || currentName,
    customerPhone: newPhone.trim() || currentPhone,
    notes:         newNotes.trim(),
    totalPrice:    newTotal
  });
}

async function updateOrderData(id, updateData) {
  try {
    const res = await fetch(`/api/orders/${id}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(updateData)
    });
    if (!res.ok) throw new Error();
    showToast('تم تعديل الطلب بنجاح! ✨');
    closeOrderModal();
    loadData();
  } catch (e) {
    showToast('فشل تعديل الطلب', 'error');
  }
}

function closeOrderModal() {
  document.getElementById('orderModal').classList.remove('active');
}

async function updateOrderStatus(id, status) {
  try {
    const res = await fetch(`/api/orders/${id}/status`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ status })
    });
    if (!res.ok) throw new Error();
    showToast('تم تحديث حالة الطلب');
    closeOrderModal();

    if (status === 'delivered' || status === 'confirmed') {
      if (confirm('هل تريد إرسال إشعار جاهزية للزبون عبر الواتساب الآن؟')) {
        sendWhatsAppNotification(id);
      }
    }

    loadData();
  } catch {
    showToast('فشل تحديث الحالة', 'error');
  }
}

// ── WhatsApp Integration ──────────────────────────────────────
function formatWhatsAppPhone(phone) {
  let cleaned = (phone || '').replace(/[^0-9]/g, '');
  if (cleaned.startsWith('07')) {
    cleaned = '964' + cleaned.substring(1);
  } else if (cleaned.startsWith('7') && cleaned.length === 10) {
    cleaned = '964' + cleaned;
  }
  return cleaned;
}

function sendWhatsAppNotification(orderId) {
  const o = allOrders.find(x => (x.orderId || x.order_id || x.id) === orderId);
  if (!o) return;

  const customerName  = o.customerName || o.customer_name || 'الزبون';
  const customerPhone = o.customerPhone || o.customer_phone || '';
  const totalPrice    = parseFloat(o.totalPrice || o.total_price || o.total || 0);

  const phone = formatWhatsAppPhone(customerPhone);
  const gamesList = (o.games || []).map(g => `• ${g.name_ar || g.nameAr || g.name}`).join('\n');
  const text = `أهلاً بك *${customerName}* 👋\n\nتم إكمال تجهيز وتثبيت ألعابك بنجاح في *مكتبة NewLife* 🎮:\n\n${gamesList}\n\n💰 المجموع: *${totalPrice.toLocaleString()} دينار*\n\n📌 يمكنك الحضور الآن لاستلام هاردك/جهازك.\nشكراً لتسوقك معنا! ❤️`;

  const url = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');
}

// ── Games ─────────────────────────────────────────────────────
// ── Games ─────────────────────────────────────────────────────
function renderGames() {
  const grid  = document.getElementById('adminGamesGrid');
  const input = document.getElementById('adminSearchInput');
  if (!grid) return;

  const q = (input ? input.value : '').toLowerCase();
  const filtered = allGames.filter(g =>
    !q ||
    g.name.toLowerCase().includes(q) ||
    (g.nameAr || '').toLowerCase().includes(q)
  );

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        <div class="empty-state__icon"><i class="fas fa-search"></i></div>
        <div class="empty-state__title">لا توجد نتائج</div>
      </div>`;
    return;
  }

  grid.innerHTML = filtered.map(game => `
    <div class="admin-game-card">
      <img
        class="admin-game-card__img"
        src="${game.image || ''}"
        alt="${game.nameAr || game.name}"
        onerror="this.src='https://placehold.co/400x140/110e20/7c3aed?text=🎮'"
        loading="lazy"
      >
      <div class="admin-game-card__body">
        <div class="admin-game-card__name">${game.nameAr || game.name}</div>
        <div class="admin-game-card__meta">
          <span><i class="fas fa-hdd" style="font-size:0.65rem;margin-left:3px;"></i>هارد ${game.hardDrive || '1'}</span>
          <span>${game.size || ''}</span>
          <span>${game.category || ''}</span>
        </div>
        <div class="admin-game-card__price">${Number(game.price).toLocaleString()} دينار</div>
      </div>
      <div class="admin-game-card__actions">
        <button class="btn btn-ghost btn-sm" style="flex:1;" onclick="openEditGameModal('${game.id}')">
          <i class="fas fa-edit"></i> تعديل
        </button>
        <button class="btn btn-ghost btn-sm" onclick="refreshGameImage('${game.id}')" title="تحديث الصورة والشرح تلقائياً">
          <i class="fas fa-sync-alt"></i>
        </button>
        <button class="btn btn-danger btn-sm" onclick="deleteGame('${game.id}')" title="حذف اللعبة">
          <i class="fas fa-trash-alt"></i>
        </button>
      </div>
    </div>
  `).join('');
}

function openGameModal() {
  document.getElementById('gameForm').reset();
  document.getElementById('gameEditId').value = '';
  document.getElementById('gameModalTitle').textContent = 'إضافة لعبة جديدة';
  document.getElementById('gameModal').classList.add('active');
}

function closeGameModal() {
  document.getElementById('gameModal').classList.remove('active');
}

function openEditGameModal(id) {
  const game = allGames.find(g => g.id === id);
  if (!game) return;

  document.getElementById('gameEditId').value     = game.id;
  document.getElementById('gameName').value       = game.name;
  document.getElementById('gameNameAr').value     = game.nameAr || '';
  document.getElementById('gamePrice').value      = game.price;
  document.getElementById('gameSize').value       = game.size;
  document.getElementById('gameCategory').value   = game.category;
  document.getElementById('gameHardDrive').value  = game.hardDrive || '1';
  document.getElementById('gameImage').value      = game.image || '';
  document.getElementById('gameDescription').value = game.description || '';

  document.getElementById('gameModalTitle').textContent = 'تعديل اللعبة';
  document.getElementById('gameModal').classList.add('active');
}

async function fetchGameDetailsOnline() {
  const nameInput = document.getElementById('gameName');
  const catInput  = document.getElementById('gameCategory');
  const query     = nameInput.value.trim();
  if (!query) {
    showToast('يرجى كتابة الاسم بالإنجليزي أولاً', 'info');
    return;
  }

  showToast('جاري البحث عن صورة وشرح اللعبة...', 'info');

  try {
    const res  = await fetch(`/api/games/search-image?q=${encodeURIComponent(query)}&category=${encodeURIComponent(catInput.value)}`);
    const data = await res.json();

    if (data && data.image) {
      document.getElementById('gameImage').value = data.image;
      if (data.description && !document.getElementById('gameDescription').value) {
        document.getElementById('gameDescription').value = data.description;
      }
      showToast('تم جلب صورة وشرح اللعبة بنجاح! ✨');
    } else {
      showToast('لم يتم العثور على صورة تلقائية للعبة', 'info');
    }
  } catch (e) {
    console.error('fetchGameDetailsOnline error:', e);
    showToast('تعذر جلب تفاصيل اللعبة', 'error');
  }
}

async function refreshGameImage(id) {
  const game = allGames.find(g => g.id === id);
  if (!game) return;

  showToast(`جاري تحديث صورة وشرح "${game.nameAr || game.name}"...`, 'info');

  try {
    const res = await fetch(`/api/games/refresh-image/${id}`, { method: 'POST' });
    const data = await res.json();

    if (res.ok && data.success) {
      showToast('تم تحديث صورة وشرح اللعبة بنجاح! ✨');
      loadData();
    } else {
      showToast(data.error || 'فشل تحديث الصورة', 'error');
    }
  } catch (e) {
    showToast('حدث خطأ أثناء التحديث', 'error');
  }
}

async function saveGame(e) {
  e.preventDefault();
  const id     = document.getElementById('gameEditId').value;
  const nameEn = document.getElementById('gameName').value.trim();
  const nameAr = document.getElementById('gameNameAr').value.trim();

  const body = {
    name:        nameEn,
    nameAr:      nameAr || nameEn,
    price:       parseInt(document.getElementById('gamePrice').value) || 0,
    size:        document.getElementById('gameSize').value.trim(),
    category:    document.getElementById('gameCategory').value,
    hardDrive:   document.getElementById('gameHardDrive').value,
    image:       document.getElementById('gameImage').value.trim(),
    description: document.getElementById('gameDescription').value.trim()
  };

  const btn  = e.target.querySelector('button[type="submit"]') ||
               document.querySelector('[form="gameForm"]');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الحفظ...'; }

  try {
    const res = await fetch(id ? `/api/games/${id}` : '/api/games', {
      method:  id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body)
    });
    const responseData = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(responseData.error || 'حدث خطأ أثناء الحفظ');
    }

    showToast(id ? 'تم تعديل اللعبة' : 'تمت إضافة اللعبة');
    closeGameModal();
    loadData();
  } catch (err) {
    showToast(err.message || 'حدث خطأ أثناء الحفظ', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> حفظ اللعبة'; }
  }
}

async function deleteGame(id) {
  const game = allGames.find(g => g.id === id);
  const name = game ? (game.nameAr || game.name) : id;
  if (!confirm(`هل أنت متأكد من حذف "${name}"؟`)) return;

  try {
    const res = await fetch(`/api/games/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error();
    showToast('تم حذف اللعبة');
    allGames = allGames.filter(g => g.id !== id);
    renderGames();
    updateDashboardStats();
  } catch {
    showToast('خطأ في الحذف', 'error');
  }
}

// ── Customers ─────────────────────────────────────────────────
function renderCustomers() {
  const tbody = document.getElementById('customersTableBody');
  if (!tbody) return;

  if (allCustomers.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--clr-text-muted);">لا يوجد زبائن مسجلون</td></tr>`;
    return;
  }

  const sorted = [...allCustomers].sort((a, b) => (b.points || 0) - (a.points || 0));

  tbody.innerHTML = sorted.map((c, i) => {
    const rankCls = i === 0 ? 'customer-rank--gold' : i === 1 ? 'customer-rank--silver' : i === 2 ? 'customer-rank--bronze' : '';
    return `<tr>
      <td><span class="customer-rank ${rankCls}">${i + 1}</span></td>
      <td style="font-family:var(--font-en);font-size:0.85rem;">${c.phone}</td>
      <td><strong>${c.name}</strong></td>
      <td><strong style="color:var(--clr-gold);">${c.points || 0}</strong> <span style="font-size:0.75rem;color:var(--clr-text-muted);">نقطة</span></td>
    </tr>`;
  }).join('');
}

// ── Sidebar (Mobile) ──────────────────────────────────────────
function toggleSidebar() {
  const sidebar  = document.getElementById('sidebar');
  const overlay  = document.getElementById('sidebarOverlay');
  const isOpen   = sidebar.classList.contains('open');
  sidebar.classList.toggle('open', !isOpen);
  if (overlay) overlay.style.display = isOpen ? 'none' : 'block';
}

function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  sidebar.classList.remove('open');
  if (overlay) overlay.style.display = 'none';
}

// ── Modal Click Outside ───────────────────────────────────────
function handleModalClick(e, modalId) {
  if (e.target.id === modalId) {
    document.getElementById(modalId).classList.remove('active');
  }
}

// ── Logout ────────────────────────────────────────────────────
function logout() {
  if (!confirm('هل تريد تسجيل الخروج؟')) return;
  localStorage.removeItem('nl_admin_token');
  window.location.href = '/login.html';
}

// ── Toast ─────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle' };
  toast.innerHTML = `<i class="fas ${icons[type] || 'fa-check-circle'}"></i> ${msg}`;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('show'));
  });

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  }, 3200);
}

// ── Admin PWA Installation Logic & Service Worker ──────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

let deferredAdminPWAInstallPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredAdminPWAInstallPrompt = e;
  const btn = document.getElementById('adminPwaInstallBtn');
  if (btn) btn.style.display = 'inline-flex';
});

function triggerAdminPWAInstall() {
  if (deferredAdminPWAInstallPrompt) {
    deferredAdminPWAInstallPrompt.prompt();
    deferredAdminPWAInstallPrompt.userChoice.then(choice => {
      if (choice.outcome === 'accepted') {
        showToast('تم تثبيت تطبيق لوحة التحكم بنجاح! 🎉');
      }
      deferredAdminPWAInstallPrompt = null;
      const btn = document.getElementById('adminPwaInstallBtn');
      if (btn) btn.style.display = 'none';
    });
  } else {
    alert('📱 لتثبيت تطبيق لوحة الأدمن كبرنامج كامل على جهازك:\n\n• على الأندرويد/الحاسوب: اضغط خيارات المتصفح (⋮) ثم اختر "تثبيت التطبيق (Install App)"\n• على الآيفون: اضغط زر المشاركة (⎕↑) ثم اختر "إضافة إلى الشاشة الرئيسية"');
  }
}

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  switchTab('dashboard', document.getElementById('nav-dashboard'));
});
