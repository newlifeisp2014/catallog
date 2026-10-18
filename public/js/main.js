/* ============================================================
   NewLife — main.js  (Customer-facing store)
   Cinema-grade Gaming Catalog UI with Hero Showcase & Live Counts
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
let allGames          = [];
let cart              = JSON.parse(localStorage.getItem('nl_cart') || '[]');
let searchQuery       = '';
let activeCategory    = 'all';
let currentSort       = 'newest';
let featuredGames     = [];
let currentHeroIndex  = 0;
let heroInterval      = null;
let currentRenderLimit = 36;

// ── Category Dictionary ───────────────────────────────────────
const catLabel = {
  Action: 'أكشن وحركة',
  Adventure: 'مغامرة',
  Sports: 'رياضة',
  RPG: 'تقمص الأدوار',
  Fighting: 'قتال',
  Shooter: 'تصويب',
  Racing: 'سباق',
  Horror: 'رعب',
  CoOp: 'ألعاب زوجية'
};

// ── DOM Refs ──────────────────────────────────────────────────
const gamesGrid         = document.getElementById('gamesGrid');
const cartBadge         = document.getElementById('cartBadge');
const navCartBadge      = document.getElementById('navCartBadge');
const cartOverlay       = document.getElementById('cartOverlay');
const cartItems         = document.getElementById('cartItems');
const cartTotal         = document.getElementById('cartTotal');
const searchInput       = document.getElementById('searchInput');
const searchClearBtn    = document.getElementById('searchClearBtn');
const gamesCountBadge   = document.getElementById('gamesCountBadge');
const filterTabs        = document.getElementById('filterTabs');
const trailerOverlay    = document.getElementById('trailerModalOverlay');
const trailerTitle      = document.getElementById('trailerModalTitle');
const trailerBody       = document.getElementById('trailerModalBody');

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  updateCartBadge();
  fetchGames();
  setupListeners();
});

// ── Sorting Helpers ───────────────────────────────────────────
function getGameDisplayName(game) {
  return ((game.nameAr && game.nameAr.trim()) ? game.nameAr.trim() : (game.name || '')).trim();
}

function sortGamesList(list, sortType = currentSort) {
  return list.slice().sort((a, b) => {
    if (sortType === 'alpha') {
      const nameA = getGameDisplayName(a);
      const nameB = getGameDisplayName(b);
      return nameA.localeCompare(nameB, ['ar', 'en'], { numeric: true, sensitivity: 'base' });
    }
    if (sortType === 'newest') {
      if (b.isNew !== a.isNew) return b.isNew ? 1 : -1;
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    }
    if (sortType === 'priceAsc') {
      return (Number(a.price) || 0) - (Number(b.price) || 0);
    }
    if (sortType === 'priceDesc') {
      return (Number(b.price) || 0) - (Number(a.price) || 0);
    }
    return 0;
  });
}

function handleSortChange(newSort) {
  currentSort = newSort;
  renderGames(true);
}

// ── Fetch Games ───────────────────────────────────────────────
async function fetchGames() {
  if (gamesGrid) {
    gamesGrid.innerHTML = `
      <div class="loader" style="grid-column:1/-1; text-align:center; padding:3rem 0;">
        <div class="spinner"></div>
        <p style="color:var(--clr-text-muted); margin-top:1rem; font-weight:600;">جاري تحميل أحدث الألعاب...</p>
      </div>`;
  }

  try {
    const res  = await fetch('/api/games?limit=2000');
    const data = await res.json();
    allGames   = data.data || [];

    // إعداد ألعاب الهيرو المميزة (5 ألعاب ذات بوسترات واضحة)
    setupFeaturedGames();
    initHeroShowcase();

    // إعداد كبسولات التصنيفات مع العدادات الحية
    renderCategoryPills();

    // عرض شبكة الألعاب
    renderGames();
  } catch (e) {
    if (gamesGrid) {
      gamesGrid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1; text-align:center; padding:3rem 0;">
          <div class="empty-state__icon" style="font-size:2.5rem; color:var(--clr-danger); margin-bottom:1rem;"><i class="fas fa-wifi-slash"></i></div>
          <div class="empty-state__title" style="font-size:1.2rem; font-weight:800;">تعذر الاتصال بالخادم</div>
          <p style="color:var(--clr-text-muted);font-size:0.88rem; margin-top:0.4rem;">يرجى التحقق من اتصال الإنترنت أو تحديث الصفحة</p>
        </div>`;
    }
  }
}

// ── Setup Featured Games ──────────────────────────────────────
function setupFeaturedGames() {
  if (!allGames || allGames.length === 0) return;

  // تفضيل الألعاب الجديدة والمميزة التي تمتلك صور ووصف أو مقطع
  const withImages = allGames.filter(g => g.image && !g.image.includes('placehold.co'));
  const newGames   = withImages.filter(g => g.isNew);
  const others     = withImages.filter(g => !g.isNew);

  featuredGames = [...newGames, ...others].slice(0, 5);

  if (featuredGames.length < 5) {
    const remaining = allGames.filter(g => !featuredGames.some(f => f.id === g.id));
    featuredGames = [...featuredGames, ...remaining].slice(0, 5);
  }
}

// ── Hero Showcase (Slider & Spotlight) ────────────────────────
function initHeroShowcase() {
  if (!featuredGames || featuredGames.length === 0) return;

  const thumbsContainer = document.getElementById('heroThumbnails');
  if (thumbsContainer) {
    thumbsContainer.innerHTML = featuredGames.map((game, i) => `
      <div 
        class="hero-thumb ${i === 0 ? 'active' : ''}" 
        onclick="selectHeroGame(${i})" 
        data-index="${i}"
        title="${game.nameAr || game.name}"
      >
        <img 
          src="${game.image || ''}" 
          alt="${game.nameAr || game.name}"
          loading="lazy"
          onerror="this.src='https://placehold.co/400x600/110e20/7c3aed?text=🎮'"
        >
      </div>
    `).join('');
  }

  // عرض اللعبة الأولى
  setHeroGame(0);

  // تشغيل التبديل التلقائي السلس كل 6 ثوانٍ
  startHeroAutoSlide();
}

function startHeroAutoSlide() {
  if (heroInterval) clearInterval(heroInterval);
  heroInterval = setInterval(() => {
    if (!featuredGames || featuredGames.length <= 1) return;
    const nextIndex = (currentHeroIndex + 1) % featuredGames.length;
    setHeroGame(nextIndex);
  }, 6500);
}

function selectHeroGame(index) {
  setHeroGame(index);
  // إعادة تشغيل المؤقت عند نقر المستخدم
  startHeroAutoSlide();
}

function setHeroGame(index) {
  if (!featuredGames || !featuredGames[index]) return;
  currentHeroIndex = index;
  const game = featuredGames[index];

  // الخلفية السينمائية
  const backdrop = document.getElementById('heroBackdrop');
  if (backdrop) {
    backdrop.style.backgroundImage = `url('${game.image || ''}')`;
  }

  // الوسم
  const heroTagText = document.getElementById('heroTagText');
  if (heroTagText) {
    heroTagText.textContent = game.isNew ? 'أضيف حديثاً 🔥' : 'لعبة مميزة ⭐';
  }

  // العناوين
  const titleEl = document.getElementById('heroTitle');
  if (titleEl) {
    titleEl.textContent = game.name || game.nameAr || '';
  }

  const subTitleEl = document.getElementById('heroSubtitle');
  if (subTitleEl) {
    if (game.nameAr && game.nameAr.trim() !== '' && game.nameAr !== game.name) {
      subTitleEl.textContent = game.nameAr;
      subTitleEl.style.display = 'block';
    } else {
      subTitleEl.style.display = 'none';
    }
  }

  // الحجم
  const sizeEl = document.getElementById('heroSize');
  if (sizeEl) {
    sizeEl.textContent = game.size || 'متوفر';
  }

  // التقييم (ديناميكي أو تقديري)
  const ratingEl = document.getElementById('heroRating');
  if (ratingEl) {
    ratingEl.textContent = '4.8 من 5';
  }

  // التاجات والتصنيف
  const genreContainer = document.getElementById('heroGenreTags');
  if (genreContainer) {
    const catName = catLabel[game.category] || game.category || 'عام';
    const hardDriveText = game.hardDrive ? `هارد ${game.hardDrive}` : '';
    genreContainer.innerHTML = `
      <span class="hero-genre-pill"><i class="fas fa-gamepad" style="margin-left:4px;"></i>${catName}</span>
      ${hardDriveText ? `<span class="hero-genre-pill" style="color:var(--clr-gold);"><i class="fas fa-hdd" style="margin-left:4px;"></i>${hardDriveText}</span>` : ''}
    `;
  }

  // النبذة
  const descEl = document.getElementById('heroDesc');
  if (descEl) {
    descEl.textContent = game.description && game.description.trim() !== ''
      ? game.description
      : `استمتع بتجربة ألعاب لا تُنسى مع لعبة ${game.nameAr || game.name}. متوفرة الآن للطلب المباشر وتثبيت سريع على جهازك.`;
  }

  // تحديث حالة زر السلة في الهيرو
  const inCart = cart.some(c => c.id === game.id);
  const heroCartBtnText = document.getElementById('heroCartBtnText');
  const heroCartBtn = document.getElementById('heroCartBtn');
  if (heroCartBtnText && heroCartBtn) {
    if (inCart) {
      heroCartBtnText.textContent = 'في السلة ✓';
      heroCartBtn.style.background = 'var(--grad-gold)';
      heroCartBtn.style.color = '#07050f';
    } else {
      heroCartBtnText.textContent = 'أضف للسلة';
      heroCartBtn.style.background = 'var(--grad-primary)';
      heroCartBtn.style.color = '#fff';
    }
  }

  // تحديث تمييز المصغّر النشط
  document.querySelectorAll('.hero-thumb').forEach((thumb, i) => {
    thumb.classList.toggle('active', i === index);
  });
}

function openHeroTrailer() {
  const game = featuredGames[currentHeroIndex];
  if (!game) return;
  openTrailerModal(game.nameAr || game.name, game.trailer, game.image);
}

function openHeroDetails() {
  const game = featuredGames[currentHeroIndex];
  if (game) openGameDetailModal(game.id);
}

function addHeroToCart() {
  const game = featuredGames[currentHeroIndex];
  if (game) {
    handleCardAction(game.id);
    const inCart = cart.some(c => c.id === game.id);
    const heroCartBtnText = document.getElementById('heroCartBtnText');
    const heroCartBtn = document.getElementById('heroCartBtn');
    if (heroCartBtnText && heroCartBtn) {
      if (inCart) {
        heroCartBtnText.textContent = 'في السلة ✓';
        heroCartBtn.style.background = 'var(--grad-gold)';
        heroCartBtn.style.color = '#07050f';
      } else {
        heroCartBtnText.textContent = 'أضف للسلة';
        heroCartBtn.style.background = 'var(--grad-primary)';
        heroCartBtn.style.color = '#fff';
      }
    }
  }
}

// ── Video Trailer Modal (Cinema Popup) ────────────────────────
function formatTrailerEmbedUrl(url) {
  if (!url || typeof url !== 'string') return '';
  url = url.trim();

  // YouTube standard watch URL: https://www.youtube.com/watch?v=XYZ
  const watchMatch = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
  if (watchMatch && watchMatch[1]) {
    return `https://www.youtube.com/embed/${watchMatch[1]}?autoplay=1&rel=0&modestbranding=1`;
  }

  return url;
}

function openTrailerModal(title, trailerUrl, poster = '') {
  if (!trailerOverlay || !trailerBody) return;

  if (trailerTitle) {
    trailerTitle.textContent = title ? `العرض الترويجي: ${title}` : 'العرض الترويجي للعبة';
  }

  if (trailerUrl && trailerUrl.trim() !== '') {
    const embedUrl = formatTrailerEmbedUrl(trailerUrl);

    if (trailerUrl.endsWith('.mp4') || trailerUrl.endsWith('.webm')) {
      trailerBody.innerHTML = `
        <video 
          src="${trailerUrl}" 
          controls 
          autoplay 
          poster="${poster}"
          style="position:absolute; inset:0; width:100%; height:100%; background:#000;"
        ></video>`;
    } else {
      trailerBody.innerHTML = `
        <iframe 
          src="${embedUrl}" 
          title="${title}"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
          allowfullscreen
          style="position:absolute; inset:0; width:100%; height:100%; border:none;"
        ></iframe>`;
    }
  } else {
    // في حال عدم وجود رابط تريلر مباشر، عرض بحث يوتيوب مباشر أو بطاقة سينمائية
    const cleanSearchTitle = encodeURIComponent(title + ' official game trailer');
    const ytSearchUrl = `https://www.youtube.com/embed?listType=search&list=${cleanSearchTitle}&autoplay=1`;
    trailerBody.innerHTML = `
      <iframe 
        src="${ytSearchUrl}" 
        title="${title}"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
        allowfullscreen
        style="position:absolute; inset:0; width:100%; height:100%; border:none;"
      ></iframe>`;
  }

  trailerOverlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeTrailerModal() {
  if (trailerOverlay) {
    trailerOverlay.classList.remove('active');
  }
  if (trailerBody) {
    // تفريغ الفيديو فوراً لإيقاف الصوت
    trailerBody.innerHTML = '';
  }
  document.body.style.overflow = '';
}

function handleTrailerOverlayClick(e) {
  if (e.target.id === 'trailerModalOverlay') {
    closeTrailerModal();
  }
}

// ── Dynamic Category Navigation with Live Counts ──────────────
function renderCategoryPills() {
  if (!filterTabs) return;

  const totalCount = allGames.length;
  const newCount   = allGames.filter(g => g.isNew).length;

  // الفئات المدعومة
  const categoriesList = [
    { key: 'all', label: 'الكل', count: totalCount },
    { key: 'isNew', label: 'أحدث الإضافات 🔥', count: newCount },
    { key: 'Action', label: 'حركة وأكشن', count: allGames.filter(g => g.category === 'Action').length },
    { key: 'Adventure', label: 'مغامرة', count: allGames.filter(g => g.category === 'Adventure').length },
    { key: 'CoOp', label: 'ألعاب زوجية', count: allGames.filter(g => g.category === 'CoOp').length },
    { key: 'Shooter', label: 'تصويب', count: allGames.filter(g => g.category === 'Shooter').length },
    { key: 'RPG', label: 'آر بي جي', count: allGames.filter(g => g.category === 'RPG').length },
    { key: 'Horror', label: 'رعب', count: allGames.filter(g => g.category === 'Horror').length },
    { key: 'Fighting', label: 'قتال', count: allGames.filter(g => g.category === 'Fighting').length },
    { key: 'Racing', label: 'سباق', count: allGames.filter(g => g.category === 'Racing').length },
    { key: 'Sports', label: 'رياضة', count: allGames.filter(g => g.category === 'Sports').length }
  ];

  filterTabs.innerHTML = categoriesList
    .filter(cat => cat.count > 0 || cat.key === 'all')
    .map(cat => `
      <button 
        class="cat-pill ${activeCategory === cat.key ? 'active' : ''}" 
        data-cat="${cat.key}"
        onclick="selectCategory('${cat.key}', this)"
      >
        <span>${cat.label}</span>
        <span class="cat-count">(${cat.count})</span>
      </button>
    `).join('');
}

function selectCategory(categoryKey, btnEl) {
  activeCategory = categoryKey;
  if (filterTabs) {
    filterTabs.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
  }
  renderGames(true);
}

function scrollCategories(distance) {
  if (filterTabs) {
    filterTabs.scrollBy({ left: distance, behavior: 'smooth' });
  }
}

// ── Search Handlers ───────────────────────────────────────────
function clearSearch() {
  if (searchInput) {
    searchInput.value = '';
    searchQuery = '';
    if (searchClearBtn) searchClearBtn.style.display = 'none';
    renderGames(true);
    searchInput.focus();
  }
}

// ── Render Games Grid ─────────────────────────────────────────
function renderGames(resetLimit = true) {
  if (resetLimit) currentRenderLimit = 36;
  const q = searchQuery.toLowerCase();

  const filtered = allGames.filter(g => {
    // فلتر البحث
    const matchSearch = !q ||
      g.name.toLowerCase().includes(q) ||
      (g.nameAr || '').toLowerCase().includes(q) ||
      (g.category || '').toLowerCase().includes(q);

    // فلتر التصنيف
    const matchCat = activeCategory === 'all' ||
      (activeCategory === 'isNew' ? Boolean(g.isNew) : g.category === activeCategory);

    return matchSearch && matchCat && g.available !== false;
  });

  // تحديث عداد الألعاب
  if (gamesCountBadge) {
    gamesCountBadge.innerHTML = `<i class="fas fa-gamepad" style="margin-left:4px;"></i> ${filtered.length} لعبة`;
  }

  if (filtered.length === 0) {
    gamesGrid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1; text-align:center; padding:3rem 1rem;">
        <div class="empty-state__icon" style="font-size:2.5rem; color:var(--clr-gold); margin-bottom:0.75rem;"><i class="fas fa-search"></i></div>
        <div class="empty-state__title" style="font-size:1.25rem; font-weight:800; color:#fff;">لا توجد ألعاب مطابقة</div>
        <p style="color:var(--clr-text-muted);font-size:0.9rem; margin-top:0.35rem;">جرب البحث بكلمة أخرى أو اختر تصنيفاً مختلفاً</p>
      </div>`;
    return;
  }

  // ترتيب الألعاب
  const sorted = sortGamesList(filtered, currentSort);

  gamesGrid.innerHTML = '';
  const gamesToShow = sorted.slice(0, currentRenderLimit);

  gamesToShow.forEach((game, i) => {
    const inCart = cart.some(c => c.id === game.id);
    const card   = buildGameCard(game, inCart, i);
    gamesGrid.appendChild(card);
  });

  // Infinite Scroll Trigger
  if (currentRenderLimit < sorted.length) {
    const loadMoreWrapper = document.createElement('div');
    loadMoreWrapper.id = 'loadMoreTrigger';
    loadMoreWrapper.style.gridColumn = '1 / -1';
    loadMoreWrapper.style.textAlign = 'center';
    loadMoreWrapper.style.padding = '2rem 0';

    loadMoreWrapper.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center; gap:8px; color:var(--clr-text-muted);">
        <i class="fas fa-spinner fa-spin" style="font-size: 1.5rem; color:var(--clr-gold);"></i>
        <div style="font-size:0.9rem; font-weight:700; color:#fff;">جاري تحميل المزيد من الألعاب...</div>
        <div style="font-size:0.78rem;">عرض ${currentRenderLimit} من أصل ${sorted.length} لعبة</div>
      </div>
    `;
    gamesGrid.appendChild(loadMoreWrapper);

    if (window.infiniteScrollObserver) {
      window.infiniteScrollObserver.disconnect();
    }

    window.infiniteScrollObserver = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        window.infiniteScrollObserver.disconnect();
        loadMoreGames();
      }
    }, { rootMargin: '300px' });

    window.infiniteScrollObserver.observe(loadMoreWrapper);
  }
}

function loadMoreGames() {
  currentRenderLimit += 36;
  renderGames(false);
}

// ── Build Game Card ───────────────────────────────────────────
function buildGameCard(game, inCart, index) {
  const card = document.createElement('div');
  const isNew = Boolean(game.isNew);
  card.className = `game-card ${inCart ? 'in-cart' : ''} ${isNew ? 'is-new' : ''}`;
  card.setAttribute('role', 'listitem');
  card.setAttribute('data-id', game.id);
  card.style.animationDelay = `${(index % 12) * 0.04}s`;

  card.innerHTML = `
    <div class="game-card__img-wrap" onclick="openGameDetailModal('${game.id}')">
      <img
        class="game-card__img"
        src="${game.image || ''}"
        alt="${game.nameAr || game.name}"
        loading="lazy"
        onerror="this.src='https://placehold.co/400x600/110e20/7c3aed?text=🎮'"
      >
      ${isNew ? `
        <div class="game-card__badge-new" title="لعبة جديدة مضافة حديثاً">
          <i class="fas fa-fire-flame-curved"></i>
          <span>جديد</span>
        </div>
      ` : ''}
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
      <div class="game-card__title">
        ${game.nameAr || game.name}
        ${isNew ? '<span class="game-card__new-tag" style="margin-right:6px;"><i class="fas fa-fire"></i> جديد</span>' : ''}
      </div>
      <div class="game-card__meta">
        <span><i class="fas fa-tag" style="font-size:0.65rem;margin-left:3px;"></i>${catLabel[game.category] || game.category}</span>
        <span>${game.size || ''}</span>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:0.4rem;">
        <div class="game-card__price" style="margin-top:0;">
          ${Number(game.price).toLocaleString()} <span style="font-size:0.75rem;font-weight:600;">دينار</span>
        </div>
        <button 
          class="btn btn-gold btn-sm"
          style="padding:0.3rem 0.65rem; border-radius:8px; font-size:0.85rem;"
          onclick="event.stopPropagation(); handleCardAction('${game.id}')"
          id="body-btn-${game.id}"
          title="${inCart ? 'في السلة' : 'إضافة للسلة'}"
        >
          <i class="fas ${inCart ? 'fa-check' : 'fa-cart-plus'}"></i>
        </button>
      </div>
    </div>`;

  return card;
}

// ── Card Action ───────────────────────────────────────────────
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
  showToast(`تمت إضافة "${game.nameAr || game.name}" إلى السلة 🎮`);
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
  const bodyBtn = document.getElementById(`body-btn-${id}`);

  if (inCart) {
    card.classList.add('in-cart');
    if (btn) btn.innerHTML = '<i class="fas fa-check"></i> في السلة ✓';
    if (bodyBtn) {
      bodyBtn.innerHTML = '<i class="fas fa-check"></i>';
      bodyBtn.title = 'في السلة';
    }
  } else {
    card.classList.remove('in-cart');
    if (btn) btn.innerHTML = '<i class="fas fa-cart-plus"></i> إضافة للسلة';
    if (bodyBtn) {
      bodyBtn.innerHTML = '<i class="fas fa-cart-plus"></i>';
      bodyBtn.title = 'إضافة للسلة';
    }
  }
}

// ── Cart Badges ───────────────────────────────────────────────
function updateCartBadge() {
  const count = cart.length;
  if (cartBadge) {
    cartBadge.textContent = count;
    cartBadge.classList.toggle('visible', count > 0);
  }
  if (navCartBadge) {
    navCartBadge.textContent = count;
  }
}

// ── Cart Drawer ───────────────────────────────────────────────
function openCart() {
  renderCartItems();
  if (cartOverlay) cartOverlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeCart() {
  if (cartOverlay) cartOverlay.classList.remove('active');
  document.body.style.overflow = '';
}

function handleOverlayClick(e) {
  if (e.target === cartOverlay) closeCart();
}

// ── Size Calculator ───────────────────────────────────────────
function parseSizeToGB(sizeStr) {
  if (!sizeStr) return 0;
  const s = sizeStr.toString().trim();
  const numMatch = s.match(/([\d.]+)/);
  if (!numMatch) return 0;
  const num = parseFloat(numMatch[1]);
  const lower = s.toLowerCase();
  if (lower.includes('tb') || lower.includes('ت')) return num * 1024;
  if (lower.includes('mb') || lower.includes('م')) return num / 1024;
  return num;
}

function formatTotalSize(games) {
  if (!games || games.length === 0) return null;
  const hasSizes = games.some(g => (g.size || g.gameSize) && parseSizeToGB(g.size || g.gameSize) > 0);
  if (!hasSizes) return null;
  const total = games.reduce((s, g) => s + parseSizeToGB(g.size || g.gameSize || ''), 0);
  if (total === 0) return null;
  if (total >= 1024) return `${(total / 1024).toFixed(1)} TB`;
  if (total < 1) return `${Math.round(total * 1024)} MB`;
  return `${Number.isInteger(total) ? total : total.toFixed(1)} GB`;
}

function renderCartItems() {
  if (!cartItems) return;

  if (cart.length === 0) {
    cartItems.innerHTML = `
      <div class="cart-empty" style="text-align:center; padding:3rem 1rem;">
        <div class="cart-empty__icon" style="font-size:3rem; color:var(--clr-text-faint); margin-bottom:1rem;"><i class="fas fa-shopping-basket"></i></div>
        <p style="font-weight:700; font-size:1.1rem; color:#fff;">سلة المشتريات فارغة</p>
        <p style="font-size:0.85rem; color:var(--clr-text-muted); margin-top:0.3rem;">تصفح الكتالوج وأضف الألعاب التي تريدها</p>
      </div>`;
    if (cartTotal) cartTotal.textContent = '0 دينار';
    const sizeEl = document.getElementById('cartSizeTotal');
    if (sizeEl) sizeEl.style.display = 'none';
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
        <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
          <div class="cart-item__price">${Number(item.price).toLocaleString()} دينار</div>
          ${item.size ? `<span style="font-size:0.73rem;background:rgba(124,58,237,0.15);color:var(--clr-primary-light);border-radius:4px;padding:0.1rem 0.4rem;font-weight:600;"><i class="fas fa-hdd" style="font-size:0.65rem;margin-left:2px;"></i>${item.size}</span>` : ''}
        </div>
      </div>
      <button class="cart-item__remove" onclick="removeFromCart('${item.id}')" aria-label="حذف ${item.nameAr || item.name}">
        <i class="fas fa-trash-alt"></i>
      </button>
    </div>
  `).join('');

  const total = cart.reduce((s, g) => s + Number(g.price), 0);
  if (cartTotal) cartTotal.textContent = `${total.toLocaleString()} دينار`;

  // عرض إجمالي الحجم
  const totalSize = formatTotalSize(cart);
  let sizeEl = document.getElementById('cartSizeTotal');
  if (!sizeEl) {
    sizeEl = document.createElement('div');
    sizeEl.id = 'cartSizeTotal';
    sizeEl.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-top:0.4rem;padding-top:0.4rem;border-top:1px dashed rgba(124,58,237,0.2);';
    const totalEl = cartTotal ? cartTotal.closest('.cart-total') : null;
    if (totalEl && totalEl.parentNode) {
      totalEl.parentNode.insertBefore(sizeEl, totalEl.nextSibling);
    }
  }
  if (totalSize) {
    sizeEl.style.display = 'flex';
    sizeEl.innerHTML = `
      <span style="font-size:0.82rem;color:var(--clr-text-muted);"><i class="fas fa-hdd" style="margin-left:4px;color:var(--clr-primary-light);"></i>إجمالي الحجم</span>
      <span style="font-size:0.88rem;font-weight:700;color:var(--clr-primary-light);">${totalSize}</span>
    `;
  } else {
    sizeEl.style.display = 'none';
  }
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
      localStorage.setItem('customer_phone', phone);
      cart = [];
      saveCart();
      updateCartBadge();
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

// ── Game Details Modal ─────────────────────────────────────────
function openGameDetailModal(gameId) {
  const game = allGames.find(g => g.id === gameId);
  if (!game) return;

  const overlay = document.getElementById('gameDetailOverlay');
  const title   = document.getElementById('gameDetailTitle');
  const body    = document.getElementById('gameDetailBody');
  if (!overlay || !body) return;

  const inCart = cart.some(c => c.id === game.id);

  title.innerHTML = `
    <i class="fas fa-compact-disc" style="color:var(--clr-gold); margin-left:0.5rem;"></i>
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
      const embedUrl = formatTrailerEmbedUrl(game.trailer);
      videoHtml = `
        <div style="position:relative; padding-bottom:56.25%; height:0; overflow:hidden; border-radius:var(--radius-lg);">
          <iframe src="${embedUrl}" style="position:absolute; top:0; left:0; width:100%; height:100%; border:0;" allowfullscreen></iframe>
        </div>`;
    }
  }

  const isNew = Boolean(game.isNew);

  body.innerHTML = `
    ${isNew ? `
      <div class="game-detail__new-alert" style="background:linear-gradient(135deg,rgba(239,68,68,0.15),rgba(245,158,11,0.15)); border:1px solid rgba(245,158,11,0.3); border-radius:12px; padding:0.8rem 1rem; display:flex; gap:0.75rem; align-items:center;">
        <i class="fas fa-fire-flame-curved" style="color:var(--clr-gold); font-size:1.3rem;"></i>
        <div>
          <div style="font-weight:800; font-size:0.95rem; color:#fff;">لعبة جديدة مضافة حديثاً! 🔥</div>
          <div style="font-size:0.8rem; color:rgba(255,255,255,0.7); margin-top:2px;">تمت إضافة هذه اللعبة مؤخراً إلى مكتبة الألعاب.</div>
        </div>
      </div>
    ` : ''}

    <div style="display:flex; gap:1.25rem; align-items:flex-start; flex-wrap:wrap;">
      <img
        src="${game.image || ''}"
        alt="${game.nameAr || game.name}"
        style="width:140px; height:195px; object-fit:cover; border-radius:var(--radius-lg); box-shadow:0 12px 28px rgba(0,0,0,0.6); border:1px solid rgba(255,255,255,0.1);"
        onerror="this.src='https://placehold.co/400x600/110e20/7c3aed?text=🎮'"
      >
      <div style="flex:1; min-width:200px; display:flex; flex-direction:column; gap:0.5rem;">
        <h3 style="font-size:1.3rem; font-weight:900; color:#fff;">${game.nameAr || game.name}</h3>
        <div style="font-size:0.9rem; color:var(--clr-text-muted); font-family:var(--font-en);">${game.name}</div>
        
        <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-top:0.35rem;">
          ${isNew ? `<span class="badge" style="background:var(--grad-amber); color:#07050f; font-weight:800; font-size:0.75rem;"><i class="fas fa-fire" style="margin-left:3px;"></i>جديد</span>` : ''}
          <span class="badge badge-pending" style="font-size:0.75rem;"><i class="fas fa-tag" style="margin-left:3px;"></i>${catLabel[game.category] || game.category}</span>
          <span class="badge badge-confirmed" style="font-size:0.75rem;"><i class="fas fa-hdd" style="margin-left:3px;"></i>هارد ${game.hardDrive || '1'}</span>
          <span class="badge badge-delivered" style="font-size:0.75rem;"><i class="fas fa-database" style="margin-left:3px;"></i>${game.size || ''}</span>
        </div>

        <div style="font-size:1.45rem; font-weight:900; color:var(--clr-gold); margin-top:0.5rem;">
          ${Number(game.price).toLocaleString()} <span style="font-size:0.85rem; font-weight:700;">دينار</span>
        </div>
      </div>
    </div>

    ${videoHtml}

    ${game.description ? `
      <div style="background:var(--clr-surface); padding:1rem 1.25rem; border-radius:var(--radius-lg); border:1px solid rgba(255,255,255,0.08);">
        <h4 style="font-size:0.95rem; font-weight:800; margin-bottom:0.4rem; color:var(--clr-gold);">
          <i class="fas fa-info-circle" style="margin-left:4px;"></i> نبذة عن اللعبة
        </h4>
        <p style="font-size:0.9rem; color:rgba(255,255,255,0.78); line-height:1.7;">${game.description}</p>
      </div>` : ''}

    <button
      class="btn btn-gold btn-full btn-lg"
      onclick="handleCardAction('${game.id}'); closeGameDetailModal();"
      style="margin-top:0.5rem; font-weight:800;"
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

// ── Search & Filter Listeners ─────────────────────────────────
function setupListeners() {
  // Live search in navbar
  if (searchInput) {
    searchInput.addEventListener('input', e => {
      searchQuery = e.target.value.trim();
      if (searchClearBtn) {
        searchClearBtn.style.display = searchQuery ? 'flex' : 'none';
      }
      renderGames(true);
    });
  }

  // Close modals on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (cartOverlay && cartOverlay.classList.contains('active')) closeCart();
      const detailOverlay = document.getElementById('gameDetailOverlay');
      if (detailOverlay && detailOverlay.classList.contains('active')) closeGameDetailModal();
      if (trailerOverlay && trailerOverlay.classList.contains('active')) closeTrailerModal();
    }
  });
}

// ── Toast Notifications ───────────────────────────────────────
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

// ── PWA Installation Logic ────────────────────────────────────
let deferredPWAInstallPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPWAInstallPrompt = e;
  const banner = document.getElementById('pwaInstallBanner');
  if (banner) banner.style.display = 'block';
});

function triggerPWAInstall() {
  if (deferredPWAInstallPrompt) {
    deferredPWAInstallPrompt.prompt();
    deferredPWAInstallPrompt.userChoice.then(choice => {
      const banner = document.getElementById('pwaInstallBanner');
      if (banner) banner.style.display = 'none';
      if (choice.outcome === 'accepted') {
        showToast('تم تثبيت التطبيق بنجاح! 🎉');
      }
      deferredPWAInstallPrompt = null;
    });
  } else {
    alert('📱 لتثبيت التطبيق كبرنامج:\n\n• أندرويد (Chrome): اضغط النقاط الثلاث ⋮ ثم "تثبيت التطبيق"\n• آيفون (Safari): اضغط زر المشاركة ⬆ ثم "إضافة إلى الشاشة الرئيسية"');
  }
}
