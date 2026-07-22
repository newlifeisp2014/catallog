/* ============================================================
   NewLife — main.js  (Customer-facing store)
   ============================================================ */

// ── PWA ──────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js')
      .then(r => console.log('[SW] Registered', r.scope))
      .catch(e => console.warn('[SW] Failed:', e));
  });
}

// ── State ─────────────────────────────────────────────────────
let allGames    = [];
let cart        = JSON.parse(localStorage.getItem('nl_cart') || '[]');
let searchQuery = '';
let activeCategory = 'all';

// ── DOM Refs ──────────────────────────────────────────────────
const gamesGrid   = document.getElementById('gamesGrid');
const cartBadge   = document.getElementById('cartBadge');
const cartOverlay = document.getElementById('cartOverlay');
const cartItems   = document.getElementById('cartItems');
const cartTotal   = document.getElementById('cartTotal');
const searchInput = document.getElementById('searchInput');

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  updateCartBadge();
  fetchGames();
  setupListeners();
});

// ── Fetch Games ───────────────────────────────────────────────
async function fetchGames() {
  gamesGrid.innerHTML = `<div class="loader"><div class="spinner"></div></div>`;

  try {
    const res  = await fetch('/api/games');
    const data = await res.json();
    allGames   = data.data || [];
    renderGames();
  } catch (e) {
    gamesGrid.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon"><i class="fas fa-wifi-slash"></i></div>
        <div class="empty-state__title">تعذر الاتصال</div>
        <p style="color:var(--clr-text-muted);font-size:0.88rem;">تحقق من الاتصال بالخادم</p>
      </div>`;
  }
}

// ── Render Games ──────────────────────────────────────────────
function renderGames() {
  const q = searchQuery.toLowerCase();

  const filtered = allGames.filter(g => {
    const matchSearch = !q ||
      g.name.toLowerCase().includes(q) ||
      (g.nameAr || '').toLowerCase().includes(q);
    const matchCat = activeCategory === 'all' || g.category === activeCategory;
    return matchSearch && matchCat && g.available !== false;
  });

  if (filtered.length === 0) {
    gamesGrid.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon"><i class="fas fa-search"></i></div>
        <div class="empty-state__title">لا توجد نتائج</div>
        <p style="color:var(--clr-text-muted);font-size:0.88rem;">جرب كلمة بحث أخرى أو تصنيف مختلف</p>
      </div>`;
    return;
  }

  gamesGrid.innerHTML = '';
  filtered.forEach((game, i) => {
    const inCart  = cart.some(c => c.id === game.id);
    const card    = buildGameCard(game, inCart, i);
    gamesGrid.appendChild(card);
  });
}

// ── Build Game Card ───────────────────────────────────────────
function buildGameCard(game, inCart, index) {
  const card = document.createElement('div');
  card.className = `game-card ${inCart ? 'in-cart' : ''}`;
  card.setAttribute('role', 'listitem');
  card.setAttribute('data-id', game.id);
  card.style.animationDelay = `${index * 0.04}s`;
  card.style.cursor = 'pointer';

  const catLabel = {
    Action: 'أكشن', Adventure: 'مغامرة', Sports: 'رياضة',
    RPG: 'آر بي جي', Fighting: 'قتال', Shooter: 'تصويب',
    Racing: 'سباق', Horror: 'رعب'
  };

  card.innerHTML = `
    <div class="game-card__img-wrap" onclick="openGameDetailModal('${game.id}')">
      <img
        class="game-card__img"
        src="${game.image || ''}"
        alt="${game.nameAr || game.name}"
        loading="lazy"
        onerror="this.src='https://placehold.co/400x600/110e20/7c3aed?text=🎮'"
      >
      <div class="game-card__badge">
        <i class="fas fa-hdd" style="font-size:0.65rem;margin-left:3px;"></i>
        هارد ${game.hardDrive || '1'}
      </div>
      <div class="game-card__in-cart" title="في السلة">
        <i class="fas fa-check"></i>
      </div>
      <div class="game-card__overlay">
        <button
          class="game-card__add-btn"
          onclick="event.stopPropagation(); handleCardAction('${game.id}')"
          id="card-btn-${game.id}"
          aria-label="${inCart ? 'إزالة من السلة' : 'إضافة للسلة'}"
        >
          <i class="fas ${inCart ? 'fa-check' : 'fa-cart-plus'}"></i>
          ${inCart ? 'في السلة ✓' : 'إضافة للسلة'}
        </button>
      </div>
    </div>
    <div class="game-card__body" onclick="openGameDetailModal('${game.id}')">
      <div class="game-card__title">${game.nameAr || game.name}</div>
      <div class="game-card__meta">
        <span><i class="fas fa-tag" style="font-size:0.65rem;margin-left:3px;"></i>${catLabel[game.category] || game.category}</span>
        <span>${game.size || ''}</span>
      </div>
      <div class="game-card__price">${Number(game.price).toLocaleString()} <span style="font-size:0.75rem;font-weight:600;">دينار</span></div>
    </div>`;

  return card;
}

// ── Card Action (Add / highlight if in cart) ───────────────────
function handleCardAction(id) {
  if (cart.some(c => c.id === id)) {
    openCart();
  } else {
    addToCart(id);
  }
}

// ── Cart Operations ───────────────────────────────────────────
function addToCart(id) {
  const game = allGames.find(g => g.id === id);
  if (!game) return;
  if (cart.some(c => c.id === id)) {
    showToast('اللعبة موجودة في السلة مسبقاً', 'info');
    return;
  }

  cart.push(game);
  saveCart();
  updateCartBadge();
  updateCardState(id, true);
  showToast(`تمت إضافة "${game.nameAr || game.name}"`);
}

function removeFromCart(id) {
  cart = cart.filter(c => c.id !== id);
  saveCart();
  updateCartBadge();
  updateCardState(id, false);
  renderCartItems();
}

function saveCart() {
  localStorage.setItem('nl_cart', JSON.stringify(cart));
}

function updateCardState(id, inCart) {
  const card = document.querySelector(`[data-id="${id}"]`);
  if (!card) return;
  const btn = card.querySelector('.game-card__add-btn');

  if (inCart) {
    card.classList.add('in-cart');
    if (btn) {
      btn.innerHTML = '<i class="fas fa-check"></i> في السلة ✓';
    }
  } else {
    card.classList.remove('in-cart');
    if (btn) {
      btn.innerHTML = '<i class="fas fa-cart-plus"></i> إضافة للسلة';
    }
  }
}

// ── Cart Badge ────────────────────────────────────────────────
function updateCartBadge() {
  const count = cart.length;
  if (cartBadge) {
    cartBadge.textContent = count;
    cartBadge.classList.toggle('visible', count > 0);
  }
}

// ── Cart Drawer ───────────────────────────────────────────────
function openCart() {
  renderCartItems();
  cartOverlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeCart() {
  cartOverlay.classList.remove('active');
  document.body.style.overflow = '';
}

function handleOverlayClick(e) {
  if (e.target === cartOverlay) closeCart();
}

function renderCartItems() {
  if (!cartItems) return;

  if (cart.length === 0) {
    cartItems.innerHTML = `
      <div class="cart-empty">
        <div class="cart-empty__icon"><i class="fas fa-shopping-basket"></i></div>
        <p style="font-weight:600;">السلة فارغة</p>
        <p style="font-size:0.82rem;color:var(--clr-text-faint);">أضف ألعاباً من الكتالوك</p>
      </div>`;
    if (cartTotal) cartTotal.textContent = '0 دينار';
    return;
  }

  cartItems.innerHTML = cart.map(item => `
    <div class="cart-item">
      <img
        class="cart-item__img"
        src="${item.image || ''}"
        alt="${item.nameAr || item.name}"
        onerror="this.src='https://placehold.co/54x72/110e20/7c3aed?text=🎮'"
      >
      <div class="cart-item__info">
        <div class="cart-item__name">${item.nameAr || item.name}</div>
        <div class="cart-item__price">${Number(item.price).toLocaleString()} دينار</div>
      </div>
      <button class="cart-item__remove" onclick="removeFromCart('${item.id}')" aria-label="حذف ${item.nameAr || item.name}">
        <i class="fas fa-trash-alt"></i>
      </button>
    </div>
  `).join('');

  const total = cart.reduce((s, g) => s + Number(g.price), 0);
  if (cartTotal) cartTotal.textContent = `${total.toLocaleString()} دينار`;
}

// ── Submit Order ──────────────────────────────────────────────
async function submitOrder(e) {
  e.preventDefault();
  if (cart.length === 0) { showToast('السلة فارغة!', 'error'); return; }

  const name  = document.getElementById('customerName').value.trim();
  const phone = document.getElementById('customerPhone').value.trim();
  if (!name || !phone) { showToast('يرجى إدخال الاسم ورقم الهاتف', 'error'); return; }

  const total = cart.reduce((s, g) => s + Number(g.price), 0);
  const payload = {
    customer_name:    name,
    customer_phone:   phone,
    customer_address: '',
    notes:            '',
    games: cart.map(g => ({
      id:        g.id,
      name:      g.name,
      name_ar:   g.nameAr || g.name_ar || '',
      price:     g.price,
      hardDrive: g.hardDrive || g.hard_drive || '1'
    })),
    total_price: total
  };

  const btn = document.getElementById('checkoutBtn');
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الإرسال...';

  try {
    const res = await fetch('/api/orders', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload)
    });

    if (res.ok) {
      // Clear cart
      cart = [];
      saveCart();
      updateCartBadge();
      // Reset all card states
      document.querySelectorAll('.game-card.in-cart').forEach(c => {
        c.classList.remove('in-cart');
        const b = c.querySelector('.game-card__add-btn');
        if (b) b.innerHTML = '<i class="fas fa-cart-plus"></i> إضافة للسلة';
      });
      closeCart();
      document.getElementById('checkoutForm').reset();
      showToast('تم إرسال طلبك بنجاح! شكراً لك 🎮');
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || 'حدث خطأ أثناء إرسال الطلب', 'error');
    }
  } catch {
    showToast('فشل الاتصال بالخادم', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}

// ── Search & Filter ───────────────────────────────────────────
function setupListeners() {
  // Search
  if (searchInput) {
    searchInput.addEventListener('input', e => {
      searchQuery = e.target.value.trim();
      renderGames();
    });
  }

  // Category filter tabs
  const filterTabs = document.getElementById('filterTabs');
  if (filterTabs) {
    filterTabs.addEventListener('click', e => {
      const tab = e.target.closest('.filter-tab');
      if (!tab) return;
      filterTabs.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeCategory = tab.dataset.cat || 'all';
      renderGames();
    });
  }

  // Close modals on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (cartOverlay && cartOverlay.classList.contains('active')) closeCart();
      const detailOverlay = document.getElementById('gameDetailOverlay');
      if (detailOverlay && detailOverlay.classList.contains('active')) closeGameDetailModal();
    }
  });
}

// ── Game Details Modal ─────────────────────────────────────────
function openGameDetailModal(gameId) {
  const game = allGames.find(g => g.id === gameId);
  if (!game) return;

  const overlay = document.getElementById('gameDetailOverlay');
  const title   = document.getElementById('gameDetailTitle');
  const body    = document.getElementById('gameDetailBody');
  if (!overlay || !body) return;

  const inCart = cart.some(c => c.id === game.id);
  const catLabel = {
    Action: 'أكشن', Adventure: 'مغامرة', Sports: 'رياضة',
    RPG: 'آر بي جي', Fighting: 'قتال', Shooter: 'تصويب',
    Racing: 'سباق', Horror: 'رعب'
  };

  title.innerHTML = `
    <i class="fas fa-compact-disc" style="color:var(--clr-primary-light); margin-left:0.5rem;"></i>
    ${game.nameAr || game.name}
  `;

  let videoHtml = '';
  if (game.trailer) {
    if (game.trailer.endsWith('.mp4') || game.trailer.endsWith('.webm')) {
      videoHtml = `
        <div style="width:100%; border-radius:var(--radius-lg); overflow:hidden; background:#000;">
          <video src="${game.trailer}" controls style="width:100%; max-height:280px;" poster="${game.image || ''}"></video>
        </div>`;
    } else {
      videoHtml = `
        <div style="position:relative; padding-bottom:56.25%; height:0; overflow:hidden; border-radius:var(--radius-lg);">
          <iframe src="${game.trailer}" style="position:absolute; top:0; left:0; width:100%; height:100%; border:0;" allowfullscreen></iframe>
        </div>`;
    }
  }

  body.innerHTML = `
    <div style="display:flex; gap:1rem; align-items:flex-start; flex-wrap:wrap;">
      <img
        src="${game.image || ''}"
        alt="${game.nameAr || game.name}"
        style="width:140px; height:190px; object-fit:cover; border-radius:var(--radius-md); box-shadow:var(--shadow-md);"
        onerror="this.src='https://placehold.co/400x600/110e20/7c3aed?text=🎮'"
      >
      <div style="flex:1; min-width:200px; display:flex; flex-direction:column; gap:0.5rem;">
        <h3 style="font-size:1.2rem; font-weight:800; color:var(--clr-text);">${game.nameAr || game.name}</h3>
        <div style="font-size:0.85rem; color:var(--clr-text-muted); font-family:var(--font-en);">${game.name}</div>
        
        <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-top:0.25rem;">
          <span class="badge badge-pending" style="font-size:0.75rem;"><i class="fas fa-tag" style="margin-left:3px;"></i>${catLabel[game.category] || game.category}</span>
          <span class="badge badge-confirmed" style="font-size:0.75rem;"><i class="fas fa-hdd" style="margin-left:3px;"></i>هارد ${game.hardDrive || '1'}</span>
          <span class="badge badge-delivered" style="font-size:0.75rem;"><i class="fas fa-database" style="margin-left:3px;"></i>${game.size || ''}</span>
        </div>

        <div style="font-size:1.3rem; font-weight:900; color:var(--clr-gold); margin-top:0.5rem;">
          ${Number(game.price).toLocaleString()} <span style="font-size:0.8rem; font-weight:600;">دينار</span>
        </div>
      </div>
    </div>

    ${videoHtml}

    ${game.description ? `
      <div style="background:var(--clr-surface); padding:1rem; border-radius:var(--radius-md); border:1px solid var(--clr-border-light);">
        <h4 style="font-size:0.9rem; font-weight:700; margin-bottom:0.4rem; color:var(--clr-primary-light);">
          <i class="fas fa-info-circle" style="margin-left:4px;"></i> نبذة عن اللعبة
        </h4>
        <p style="font-size:0.88rem; color:var(--clr-text-muted); line-height:1.6;">${game.description}</p>
      </div>` : ''}

    <button
      class="btn btn-gold btn-full btn-lg"
      onclick="handleCardAction('${game.id}'); closeGameDetailModal();"
      style="margin-top:0.5rem;"
    >
      <i class="fas ${inCart ? 'fa-check' : 'fa-cart-plus'}"></i>
      ${inCart ? 'في السلة — افتح السلة' : 'إضافة إلى سلة المشتريات'}
    </button>
  `;

  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeGameDetailModal() {
  const overlay = document.getElementById('gameDetailOverlay');
  if (overlay) overlay.classList.remove('active');
  document.body.style.overflow = '';
}

function handleGameDetailOverlayClick(e) {
  if (e.target.id === 'gameDetailOverlay') closeGameDetailModal();
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
