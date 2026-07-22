const express = require('express');
const pool = require('../db');
const verifyToken = require('../middleware/auth');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const https = require('https');

// ==================== إعدادات ====================
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY || '';
const IMAGES_DIR = path.join(__dirname, '..', 'public', 'images', 'games');

// إنشاء مجلد الصور إذا ما موجود
if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

// ==================== دوال مساعدة ====================

// تحميل صورة وحفظها محلياً
function downloadImage(url, filename) {
    return new Promise((resolve) => {
        if (!url || url.includes('placehold.co')) {
            return resolve(null);
        }

        const filePath = path.join(IMAGES_DIR, filename);

        if (fs.existsSync(filePath)) {
            return resolve(`/images/games/${filename}`);
        }

        const req = https.get(url, { timeout: 15000 }, (resp) => {
            if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
                return downloadImage(resp.headers.location, filename).then(resolve);
            }
            if (resp.statusCode !== 200) {
                return resolve(null);
            }

            const file = fs.createWriteStream(filePath);
            resp.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve(`/images/games/${filename}`);
            });
        });

        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
    });
}

// جلب JSON من URL
function fetchJson(url, options = {}) {
    return new Promise((resolve) => {
        const req = https.get(url, { 
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json',
                ...options.headers
            }
        }, (resp) => {
            if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
                return fetchJson(resp.headers.location, options).then(resolve);
            }
            let data = '';
            resp.on('data', (chunk) => data += chunk);
            resp.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { resolve(null); }
            });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
    });
}

// التحقق من الصورة
function checkImageValid(url) {
    return new Promise((resolve) => {
        const req = https.get(url, { timeout: 8000, method: 'HEAD' }, (resp) => {
            if (resp.statusCode !== 200) {
                return resolve({ valid: false, size: 0 });
            }
            const contentLength = parseInt(resp.headers['content-length'] || '0');
            resolve({ valid: contentLength > 5000, size: contentLength });
        });
        req.on('error', () => resolve({ valid: false, size: 0 }));
        req.on('timeout', () => { req.destroy(); resolve({ valid: false, size: 0 }); });
    });
}

// مقارنة أسماء الألعاب (تشابه)
function nameSimilarity(name1, name2) {
    const n1 = name1.toLowerCase().replace(/[^a-z0-9]/g, '');
    const n2 = name2.toLowerCase().replace(/[^a-z0-9]/g, '');

    if (n1 === n2) return 1.0;
    if (n1.includes(n2) || n2.includes(n1)) return 0.8;

    // حساب التشابه البسيط
    let matches = 0;
    const minLen = Math.min(n1.length, n2.length);
    for (let i = 0; i < minLen; i++) {
        if (n1[i] === n2[i]) matches++;
    }
    return matches / Math.max(n1.length, n2.length);
}

// ==================== 1. RAWG API (أفضل للألعاب الحصرية) ====================

async function searchRAWG(query) {
    try {
        const searchUrl = `https://api.rawg.io/api/games?search=${encodeURIComponent(query)}&page_size=5&platforms=18,187`;
        const data = await fetchJson(searchUrl);

        if (!data || !data.results || data.results.length === 0) return null;

        // نختار أفضل تطابق
        let bestMatch = null;
        let bestScore = 0;

        for (const game of data.results) {
            const score = nameSimilarity(query, game.name);
            if (score > bestScore) {
                bestScore = score;
                bestMatch = game;
            }
        }

        // إذا التشابه ضعيف، نستخدم الأول
        if (!bestMatch) bestMatch = data.results[0];

        // إذا التشابه أقل من 0.3، نرفض
        if (bestScore < 0.3 && data.results.length > 1) {
            console.log(`⚠️ RAWG: تشابه ضعيف (${bestScore.toFixed(2)}) لـ "${query}"`);
        }

        let image = bestMatch.background_image || null;

        // جلب تفاصيل إضافية للصورة الأفضل
        if (bestMatch.slug) {
            const detailUrl = `https://api.rawg.io/api/games/${bestMatch.slug}`;
            const detail = await fetchJson(detailUrl);
            if (detail) {
                if (detail.background_image_additional) {
                    image = detail.background_image_additional;
                }
            }
        }

        console.log(`🌐 RAWG: "${query}" -> "${bestMatch.name}" (${bestScore.toFixed(2)}) -> ${image ? '✅' : '❌'}`);
        return { 
            image, 
            description: bestMatch.description_raw || bestMatch.description || '', 
            trailer: '',
            source: 'rawg',
            gameName: bestMatch.name
        };
    } catch (e) {
        console.error('RAWG error:', e.message);
        return null;
    }
}

// ==================== 2. Steam API (مع فلترة) ====================

async function searchSteam(query) {
    try {
        const searchUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&l=english&cc=US`;
        const searchData = await fetchJson(searchUrl);

        if (!searchData || !searchData.items || searchData.items.length === 0) return null;

        // نختار أفضل تطابق من النتائج
        let bestMatch = null;
        let bestScore = 0;

        for (const item of searchData.items) {
            const score = nameSimilarity(query, item.name);
            if (score > bestScore) {
                bestScore = score;
                bestMatch = item;
            }
        }

        if (!bestMatch) bestMatch = searchData.items[0];

        // إذا التشابه أقل من 0.4، نرفض (لعبة غلط!)
        if (bestScore < 0.4) {
            console.log(`⚠️ Steam: تشابه ضعيف (${bestScore.toFixed(2)}) لـ "${query}" -> "${bestMatch.name}"`);
            return null;
        }

        const appId = bestMatch.id;
        const gameName = bestMatch.name;

        // روابط صور Steam
        const imageUrls = [
            `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900_2x.jpg`,
            `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`,
            `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900_2x.jpg`,
            `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`,
            `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
            `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`
        ];

        const detailsUrl = `https://store.steampowered.com/api/appdetails?appids=${appId}&l=arabic`;
        const detailsData = await fetchJson(detailsUrl);

        let description = '';
        let trailer = '';
        let finalImage = null;

        if (detailsData && detailsData[appId] && detailsData[appId].success) {
            const appData = detailsData[appId].data;
            if (appData.short_description) {
                description = appData.short_description.replace(/<[^>]*>?/gm, '').trim();
            }
            if (appData.movies && appData.movies.length > 0) {
                const movie = appData.movies[0];
                trailer = movie.mp4?.max || movie.mp4?.['480'] || movie.webm?.max || movie.webm?.['480'] || '';
            }
        }

        for (const url of imageUrls) {
            const check = await checkImageValid(url);
            if (check.valid) {
                finalImage = url;
                break;
            }
        }

        console.log(`🎮 Steam: "${query}" -> "${gameName}" (${bestScore.toFixed(2)}) -> ${finalImage ? '✅' : '❌'}`);
        return { 
            image: finalImage, 
            description, 
            trailer, 
            source: 'steam',
            gameName
        };
    } catch (e) {
        console.error('Steam error:', e.message);
        return null;
    }
}

// ==================== 3. Unsplash API ====================

async function searchUnsplash(query) {
    if (!UNSPLASH_ACCESS_KEY) return null;

    try {
        const searchTerms = [
            `${query} video game cover`,
            `${query} game art`,
            `${query} playstation`,
            `video game ${query}`
        ];

        for (const term of searchTerms) {
            const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(term)}&per_page=1&orientation=portrait&client_id=${UNSPLASH_ACCESS_KEY}`;
            const data = await fetchJson(url);

            if (data && data.results && data.results.length > 0) {
                const photo = data.results[0];
                console.log(`📷 Unsplash: "${query}" -> ✅`);
                return {
                    image: photo.urls.regular || photo.urls.small,
                    description: photo.description || photo.alt_description || '',
                    source: 'unsplash'
                };
            }
        }

        console.log(`📷 Unsplash: "${query}" -> ❌`);
        return null;
    } catch (e) {
        console.error('Unsplash error:', e.message);
        return null;
    }
}

// ==================== 4. صورة احتياطية ====================

function getPlaceholderImage(gameName, category) {
    const colors = {
        'Action': 'e63946',
        'Adventure': 'f4a261',
        'Fighting': 'e76f51',
        'Racing': '2a9d8f',
        'Sports': '264653',
        'Shooter': 'e9c46a',
        'RPG': '9b5de5',
        'Horror': '1a1a2e',
        'default': '1d3557'
    };

    const color = colors[category] || colors['default'];
    const text = encodeURIComponent(gameName.substring(0, 15));

    return `https://placehold.co/400x600/${color}/ffffff?text=${text}&font=roboto`;
}

// ==================== البحث الشامل (RAWG أولاً) ====================

async function searchGameImage(query, category = 'default') {
    console.log(`\n🔍 البحث عن: "${query}"`);

    let result = { 
        image: null, 
        description: '', 
        trailer: '',
        source: 'none'
    };

    // 1. جرب RAWG أولاً (أفضل للألعاب الحصرية مثل God of War)
    const rawg = await searchRAWG(query);
    if (rawg && rawg.image) {
        result = { ...rawg };
        console.log(`✅ RAWG: ${rawg.gameName}`);
    }

    // 2. إذا RAWG فشل، جرب Steam
    if (!result.image) {
        const steam = await searchSteam(query);
        if (steam && steam.image) {
            result = { ...steam };
            console.log(`✅ Steam: ${steam.gameName}`);
        }
    }

    // 3. إذا فشل، جرب Unsplash
    if (!result.image) {
        const unsplash = await searchUnsplash(query);
        if (unsplash && unsplash.image) {
            result = { ...unsplash };
            console.log(`✅ Unsplash`);
        }
    }

    // 4. صورة احتياطية
    if (!result.image) {
        result.image = getPlaceholderImage(query, category);
        result.source = 'placeholder';
        console.log(`⚠️ Placeholder`);
    }

    console.log(`📊 المصدر النهائي: ${result.source}`);
    return result;
}

// ==================== Routes ====================

// Get all games (public) with pagination
router.get('/', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 1000;
        const offset = (page - 1) * limit;
        const category = req.query.category;

        let queryStr = 'SELECT * FROM games';
        let params = [];
        let countQueryStr = 'SELECT COUNT(*) FROM games';
        let countParams = [];

        if (category && category !== 'all') {
            queryStr += ' WHERE category = $1';
            countQueryStr += ' WHERE category = $1';
            params.push(category);
            countParams.push(category);
        }

        queryStr += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        const result = await pool.query(queryStr, params);
        const totalResult = await pool.query(countQueryStr, countParams);
        const totalGames = parseInt(totalResult.rows[0].count);

        const games = result.rows.map(row => ({
            id: row.id,
            name: row.name,
            nameAr: row.name_ar,
            price: row.price,
            size: row.size,
            category: row.category,
            image: row.image,
            description: row.description,
            trailer: row.trailer,
            notes: row.notes,
            available: row.available,
            hardDrive: row.hard_drive
        }));

        res.json({
            data: games,
            total: totalGames,
            page: page,
            totalPages: Math.ceil(totalGames / limit)
        });
    } catch (error) {
        console.error('Error fetching games:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Add new game (Protected) - مع جلب صورة تلقائي
router.post('/', verifyToken, async (req, res) => {
    try {
        const { name, nameAr, price, size, category, image, description, trailer, notes, hardDrive } = req.body;

        if (!name || !nameAr || !price || !size || !category) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const id = 'ps4_' + Date.now().toString().slice(-6);

        let finalImage = image;
        let finalDescription = description || '';
        let finalTrailer = trailer || '';

        if (!finalImage) {
            const searchResult = await searchGameImage(name, category);
            finalImage = searchResult.image;
            if (!finalDescription) finalDescription = searchResult.description;
            if (!finalTrailer) finalTrailer = searchResult.trailer;

            // حفظ الصورة محلياً (إذا مو placeholder)
            if (finalImage && !finalImage.includes('placehold.co')) {
                const safeName = name.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
                const ext = 'jpg';
                const filename = `${safeName}_${id}.${ext}`;
                const localPath = await downloadImage(finalImage, filename);
                if (localPath) {
                    finalImage = localPath;
                }
            }
        }

        await pool.query(
            'INSERT INTO games (id, name, name_ar, price, size, category, image, description, trailer, notes, hard_drive) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
            [id, name, nameAr, price, size, category, finalImage, finalDescription, finalTrailer, notes || '', hardDrive || '1']
        );

        res.json({ 
            id, name, nameAr, price, size, category, 
            image: finalImage, description: finalDescription, 
            trailer: finalTrailer, notes, hardDrive: hardDrive || '1'
        });
    } catch (error) {
        console.error('Error adding game:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Update game (Protected)
router.put('/:id', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, nameAr, price, size, category, image, description, trailer, notes, hardDrive } = req.body;

        await pool.query(
            'UPDATE games SET name = $1, name_ar = $2, price = $3, size = $4, category = $5, image = $6, description = $7, trailer = $8, notes = $9, hard_drive = $10 WHERE id = $11',
            [name, nameAr, price, size, category, image, description || '', trailer || '', notes || '', hardDrive || '1', id]
        );

        res.json({ id, name, nameAr, price, size, category, image, description, trailer, notes, hardDrive: hardDrive || '1' });
    } catch (error) {
        console.error('Error updating game:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Delete game (Protected)
router.delete('/:id', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;

        const gameResult = await pool.query('SELECT image FROM games WHERE id = $1', [id]);
        if (gameResult.rows.length > 0) {
            const imagePath = gameResult.rows[0].image;
            if (imagePath && imagePath.startsWith('/images/games/')) {
                const fullPath = path.join(__dirname, '..', 'public', imagePath);
                if (fs.existsSync(fullPath)) {
                    try {
                        fs.unlinkSync(fullPath);
                    } catch (fsErr) {
                        console.error('Error deleting image file:', fsErr);
                    }
                }
            }
        }

        await pool.query('DELETE FROM games WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting game:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Search game details (Protected) - للأدمن
router.get('/search-image', verifyToken, async (req, res) => {
    try {
        const query = req.query.q;
        const category = req.query.category || 'default';
        if (!query) return res.json({ image: null, description: null, trailer: null });

        console.log(`\n🔍 البحث عن لعبة: "${query}"`);

        const result = await searchGameImage(query, category);

        console.log(`✅ النتيجة: source=${result.source}, image=${!!result.image}`);

        res.json(result);

    } catch (error) {
        console.error('Search image API error:', error);
        res.json({ image: null, description: null, trailer: null });
    }
});

// Refresh game image (Protected)
router.post('/refresh-image/:id', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;

        const gameResult = await pool.query('SELECT name, name_ar, category FROM games WHERE id = $1', [id]);
        if (gameResult.rows.length === 0) {
            return res.status(404).json({ error: 'Game not found' });
        }

        const game = gameResult.rows[0];
        const searchQuery = game.name_ar || game.name;

        const searchResult = await searchGameImage(searchQuery, game.category);

        let finalImage = searchResult.image;
        if (finalImage && !finalImage.includes('placehold.co')) {
            const safeName = game.name.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
            const ext = 'jpg';
            const filename = `${safeName}_${id}_refresh.${ext}`;
            const localPath = await downloadImage(finalImage, filename);
            if (localPath) {
                finalImage = localPath;
            }
        }

        await pool.query(
            'UPDATE games SET image = $1, description = $2, trailer = $3 WHERE id = $4',
            [finalImage, searchResult.description, searchResult.trailer, id]
        );

        res.json({ 
            success: true, 
            image: finalImage, 
            description: searchResult.description, 
            trailer: searchResult.trailer,
            source: searchResult.source
        });
    } catch (error) {
        console.error('Refresh image error:', error);
        res.status(500).json({ error: 'Failed to refresh image' });
    }
});

// Bulk refresh all images (Protected)
router.post('/refresh-all-images', verifyToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, name, name_ar, category, image FROM games');
        const games = result.rows;

        let updated = 0;
        let failed = 0;

        for (const game of games) {
            try {
                if (!game.image || game.image.includes('placehold.co')) {
                    const searchQuery = game.name_ar || game.name;
                    const searchResult = await searchGameImage(searchQuery, game.category);

                    let finalImage = searchResult.image;
                    if (finalImage && !finalImage.includes('placehold.co')) {
                        const safeName = game.name.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
                        const filename = `${safeName}_${game.id}.jpg`;
                        const localPath = await downloadImage(finalImage, filename);
                        if (localPath) {
                            finalImage = localPath;
                        }
                    }

                    await pool.query(
                        'UPDATE games SET image = $1 WHERE id = $2',
                        [finalImage, game.id]
                    );
                    updated++;
                }
            } catch (e) {
                failed++;
                console.error(`Failed to refresh ${game.name}:`, e.message);
            }
        }

        res.json({ success: true, updated, failed, total: games.length });
    } catch (error) {
        console.error('Bulk refresh error:', error);
        res.status(500).json({ error: 'Failed to refresh images' });
    }
});

module.exports = router;
