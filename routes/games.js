const express = require('express');
const pool = require('../db');
const verifyToken = require('../middleware/auth');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// ==================== إعدادات ====================
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY || '';
const IMAGES_DIR = path.join(__dirname, '..', 'public', 'images', 'games');

// إنشاء مجلد الصور إذا ما موجود
if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

// ==================== دوال تخزين الصور في قاعدة البيانات (PostgreSQL) ====================

// تحميل الصورة كـ Buffer ثنائي
function downloadImageBuffer(url) {
    return new Promise((resolve) => {
        if (!url || typeof url !== 'string' || url.includes('placehold.co')) return resolve(null);

        try {
            const safeUrl = url.includes('%') ? url : encodeURI(url);
            const parsedUrl = new URL(safeUrl);
            const options = {
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
                    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
                }
            };

            const protocol = parsedUrl.protocol === 'https:' ? https : http;
            const req = protocol.get(parsedUrl, options, (resp) => {
                if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
                    const redirectUrl = new URL(resp.headers.location, parsedUrl).href;
                    return downloadImageBuffer(redirectUrl).then(resolve);
                }
                if (resp.statusCode !== 200) return resolve(null);

                const contentType = resp.headers['content-type'] || 'image/jpeg';
                const chunks = [];
                resp.on('data', chunk => chunks.push(chunk));
                resp.on('end', () => {
                    const buffer = Buffer.concat(chunks);
                    resolve({ buffer, contentType });
                });
            });

            req.on('error', () => resolve(null));
            req.on('timeout', () => { req.destroy(); resolve(null); });
        } catch (err) {
            resolve(null);
        }
    });
}

// حفظ الصورة مباشرة في جدول game_images بقاعدة البيانات (حفظ دائم لا يضيع أبداً مع أي تعديل أو إعادة رفع)
async function saveGameImageToDB(id, bufferOrDataUrl, mimeType = 'image/jpeg', sourceUrl = '') {
    try {
        let dataUri = '';
        if (typeof bufferOrDataUrl === 'string' && bufferOrDataUrl.startsWith('data:image/')) {
            dataUri = bufferOrDataUrl;
        } else if (Buffer.isBuffer(bufferOrDataUrl)) {
            dataUri = `data:${mimeType};base64,${bufferOrDataUrl.toString('base64')}`;
        } else {
            return false;
        }

        await pool.query(`
            INSERT INTO game_images (id, image_data, mime_type, source_url, updated_at)
            VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
            ON CONFLICT (id) 
            DO UPDATE SET 
                image_data = EXCLUDED.image_data,
                mime_type = EXCLUDED.mime_type,
                source_url = COALESCE(NULLIF(EXCLUDED.source_url, ''), game_images.source_url),
                updated_at = CURRENT_TIMESTAMP
        `, [id, dataUri, mimeType, sourceUrl || '']);

        return true;
    } catch (err) {
        console.error('Error saving image to DB:', err.message);
        return false;
    }
}

// تحميل وحفظ الصورة في قاعدة البيانات
async function downloadAndStoreImage(gameId, url) {
    if (!url || url.includes('placehold.co')) return null;

    try {
        const dl = await downloadImageBuffer(url);
        if (dl && dl.buffer) {
            await saveGameImageToDB(gameId, dl.buffer, dl.contentType, url);
            return `/api/games/image/${gameId}`;
        }
    } catch (e) {
        console.warn('downloadAndStoreImage error:', e.message);
    }
    return url;
}

// ==================== محرك التصنيف التلقائي الذكي للألعاب ====================
function autoClassifyGame(name = '', nameAr = '', description = '', genres = []) {
    const textToAnalyze = `${name} ${nameAr} ${description} ${(Array.isArray(genres) ? genres.join(' ') : '')}`.toLowerCase();
    const cleanName = (name || '').toLowerCase();
    const cleanNameAr = (nameAr || '').toLowerCase();

    // 1. Horror (رعب)
    const horrorTitles = [
        'resident evil', 'silent hill', 'outlast', 'evil within', 'dead space', 'alien isolation',
        'until dawn', 'little nightmares', 'five nights at freddy', 'alan wake', 'amnesia',
        'layers of fear', 'fatal frame', 'callisto protocol', 'slender', 'blair witch', 'visage',
        'dark pictures', 'man of medan', 'little hope', 'house of ashes', 'devil in me', 'the quarry',
        'dying light', 'tormented souls', 'daymare', 'siren', 'fnaf', 'dead by daylight', 'soma',
        'fear', 'alone in the dark', 'phasmophobia', 'left 4 dead', 'world war z', 'dead island', 'evil dead'
    ];
    const isHorrorTitle = horrorTitles.some(t => cleanName.includes(t) || cleanNameAr.includes(t));
    const horrorKeywords = ['horror', 'رعب', 'survival horror', 'psychological horror', 'مخيف', 'زومبي', 'اشباح', 'شر مقيم'];
    if (isHorrorTitle || horrorKeywords.some(k => textToAnalyze.includes(k))) {
        return 'Horror';
    }

    // 2. CoOp (ألعاب زوجية / لاعبين اثنين)
    const coopTitles = [
        'it takes two', 'a way out', 'overcooked', 'unravel two', 'unravel 2', 'cuphead', 'lego',
        'moving out', 'rayman legends', 'sackboy', 'littlebigplanet', 'broforce', 'trine',
        'lovers in a dangerous', 'knack', 'castle crashers', 'guacamelee', 'human fall flat',
        'gang beasts', 'haven', 'portal 2', 'streets of rage', 'don\'t starve together',
        'teenage mutant ninja turtles', 'tmnt', 'brothers: a tale of two sons', 'it takes 2'
    ];
    const isCoopTitle = coopTitles.some(t => cleanName.includes(t) || cleanNameAr.includes(t));
    const coopKeywords = ['co-op', 'coop', 'couch co-op', 'split screen', 'split-screen', 'زوجية', 'شخصين', 'لشخصين', 'تعاونية', 'العاب زوجية'];
    if (isCoopTitle || coopKeywords.some(k => textToAnalyze.includes(k))) {
        return 'CoOp';
    }

    // 3. Fighting (قتال)
    const fightingTitles = [
        'mortal kombat', 'tekken', 'street fighter', 'injustice', 'dragon ball', 'guilty gear',
        'king of fighters', 'soulcalibur', 'ufc', 'wwe 2k', 'naruto', 'dead or alive',
        'marvel vs capcom', 'jump force', 'demon slayer', 'my hero', 'brawlhalla', 'super smash',
        'sifu', 'kof', 'samurai shodown', 'virtua fighter', 'melty blood', 'blazblue', 'fatal fury',
        'boxing', 'fight night', 'creed'
    ];
    const isFightingTitle = fightingTitles.some(t => cleanName.includes(t) || cleanNameAr.includes(t));
    const fightingKeywords = ['fighting', 'قتال', 'قتالية', 'ملاكمة', 'مصارعة', 'brawler', 'beat \'em up', '1v1', 'martial arts'];
    if (isFightingTitle || fightingKeywords.some(k => textToAnalyze.includes(k))) {
        return 'Fighting';
    }

    // 4. Sports (رياضة)
    const sportsTitles = [
        'fifa', 'ea sports fc', 'fc 24', 'fc 25', 'fc 26', 'efootball', 'pes ', 'pro evolution soccer',
        'nba 2k', 'madden nfl', 'mlb the show', 'nhl', 'pga tour', 'tony hawk', 'skate',
        'wwe', 'topspin', 'tennis', 'riders republic', 'steep', 'rocket league', 'captain tsubasa',
        'golf', 'football manager', 'handball', 'volleyball', 'badminton'
    ];
    const isSportsTitle = sportsTitles.some(t => cleanName.includes(t) || cleanNameAr.includes(t) || cleanName.startsWith('pes'));
    const sportsKeywords = ['sports', 'رياضة', 'كرة قدم', 'كرة سلة', 'كورة', 'soccer', 'football', 'basketball', 'baseball'];
    if (isSportsTitle || sportsKeywords.some(k => textToAnalyze.includes(k))) {
        return 'Sports';
    }

    // 5. Racing (سباق)
    const racingTitles = [
        'need for speed', 'nfs', 'gran turismo', 'forza', 'the crew', 'dirt', 'f1 2', 'f1 20',
        'grid', 'burnout', 'assetto corsa', 'wrc', 'project cars', 'asphalt', 'hot wheels',
        'crash team racing', 'ctr', 'sonic racing', 'kart', 'wreckfest', 'ride ', 'motogp',
        'monster energy supercross', 'snowrunner', 'mudrunner', 'flatout', 'fast & furious', 'fast and furious'
    ];
    const isRacingTitle = racingTitles.some(t => cleanName.includes(t) || cleanNameAr.includes(t));
    const racingKeywords = ['racing', 'سباق', 'سيارات', 'دراجات', 'driving', 'automotive', 'motorsport'];
    if (isRacingTitle || racingKeywords.some(k => textToAnalyze.includes(k))) {
        return 'Racing';
    }

    // 6. Shooter (تصويب)
    const shooterTitles = [
        'call of duty', 'cod', 'battlefield', 'doom', 'wolfenstein', 'rainbow six', 'sniper elite',
        'sniper ghost warrior', 'metro exodus', 'metro 2033', 'metro last light', 'titanfall',
        'halo', 'payday', 'borderlands', 'bioshock', 'ghost recon', 'the division', 'overwatch',
        'apex legends', 'destiny', 'far cry', 'spec ops', 'killzone', 'resistance', 'crysis',
        'stalker', 'battlefront', 'quake', 'medal of honor'
    ];
    const isShooterTitle = shooterTitles.some(t => cleanName.includes(t) || cleanNameAr.includes(t));
    const shooterKeywords = ['shooter', 'fps', 'تصويب', 'قنص', 'اطلاق نار', 'first-person shooter', 'third-person shooter', 'tactical shooter'];
    if (isShooterTitle || shooterKeywords.some(k => textToAnalyze.includes(k))) {
        return 'Shooter';
    }

    // 7. RPG (آر بي جي)
    const rpgTitles = [
        'elden ring', 'the witcher', 'witcher', 'dark souls', 'bloodborne', 'demon\'s souls',
        'skyrim', 'elder scrolls', 'fallout', 'final fantasy', 'cyberpunk 2077', 'monster hunter',
        'dragon age', 'persona', 'tales of', 'kingdom hearts', 'hogwarts legacy', 'nioh',
        'lies of p', 'sekiro', 'baldur\'s gate', 'diablo', 'mass effect', 'dragon\'s dogma',
        'shin megami tensei', 'star ocean', 'nier:automata', 'nier automata', 'nier replicant',
        'genshin', 'ys viii', 'ys ix', 'dragon quest'
    ];
    const isRpgTitle = rpgTitles.some(t => cleanName.includes(t) || cleanNameAr.includes(t));
    const rpgKeywords = ['rpg', 'role-playing', 'آر بي جي', 'ار بي جي', 'تقمص ادوار', 'action rpg', 'jrpg'];
    if (isRpgTitle || rpgKeywords.some(k => textToAnalyze.includes(k))) {
        return 'RPG';
    }

    // 8. Adventure (مغامرة)
    const adventureTitles = [
        'red dead redemption', 'rdr', 'uncharted', 'tomb raider', 'horizon zero dawn',
        'horizon forbidden west', 'ghost of tsushima', 'death stranding', 'the last of us',
        'days gone', 'assassin\'s creed', 'assassins creed', 'life is strange', 'detroit: become human',
        'heavy rain', 'beyond: two souls', 'stray', 'journey', 'shadow of the colossus',
        'the last guardian', 'star wars jedi', 'batman arkham', 'spider-man', 'spiderman',
        'guardians of the galaxy', 'marvel\'s avengers', 'god of war', 'prince of persia'
    ];
    const isAdvTitle = adventureTitles.some(t => cleanName.includes(t) || cleanNameAr.includes(t));
    const adventureKeywords = ['adventure', 'مغامرة', 'مغامرات', 'open-world', 'open world', 'narrative', 'story-rich'];
    if (isAdvTitle || adventureKeywords.some(k => textToAnalyze.includes(k))) {
        return 'Adventure';
    }

    // 9. Action (أكشن - الافتراضي)
    return 'Action';
}

// ==================== دوال مساعدة إضافية ====================

// تحميل صورة وحفظها محلياً (كاش احتياطي)
function downloadImage(url, filename) {
    return new Promise((resolve) => {
        if (!url || url.includes('placehold.co')) {
            return resolve(null);
        }

        const filePath = path.join(IMAGES_DIR, filename);

        if (fs.existsSync(filePath)) {
            return resolve(`/images/games/${filename}`);
        }

        const options = {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
            }
        };

        const protocol = url.startsWith('https') ? https : http;
        const req = protocol.get(url, options, (resp) => {
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

// ==================== 4. PS4 Wikipedia / Cover Art API ====================

async function searchPS4Cover(query) {
    try {
        const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages&titles=${encodeURIComponent(query)}&piprop=original|thumbnail&pithumbsize=600`;
        const data = await fetchJson(searchUrl);
        if (!data || !data.query || !data.query.pages) return null;

        const pages = data.query.pages;
        for (const pageId in pages) {
            const page = pages[pageId];
            if (page.original && page.original.source && (page.original.source.includes('cover') || page.original.source.includes('boxart') || page.original.source.includes('jpg') || page.original.source.includes('png'))) {
                return { image: page.original.source, source: 'wikipedia' };
            } else if (page.thumbnail && page.thumbnail.source) {
                return { image: page.thumbnail.source, source: 'wikipedia' };
            }
        }
        return null;
    } catch (e) {
        return null;
    }
}

// ==================== 5. صورة غلاف بلايستيشن 4 احتياطية ====================

function getPlaceholderImage(gameName, category) {
    const text = encodeURIComponent(`PS4 | ${gameName.substring(0, 18)}`);
    return `https://placehold.co/400x600/003087/ffffff?text=${text}&font=space-grotesk`;
}

// ==================== 6. YouTube Search ====================
async function searchYouTube(query) {
    try {
        const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query + ' PS4 Trailer')}`;
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });
        const html = await res.text();
        // نبحث عن أول نتيجة فيديو حقيقية في بحث يوتيوب
        const match = html.match(/"videoRenderer":\{"videoId":"([^"]+)"/);
        if (match && match[1]) {
            const videoId = match[1];
            console.log(`📺 YouTube: "${query}" -> Found Video ID: ${videoId}`);
            return {
                trailer: `https://www.youtube.com/embed/${videoId}?autoplay=1`,
                thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
            };
        }
        return null;
    } catch (e) {
        console.error('YouTube error:', e.message);
        return null;
    }
}

// ==================== 0. PSPKG Search (PlayStation Games Center - pspkg.com) ====================
async function searchPSPKG(query) {
    if (!query || !query.trim()) return null;

    try {
        const cleanQ = query.trim();

        // 1. إذا قام المستخدم بلصق رابط مباشر من pspkg.com
        if (cleanQ.includes('pspkg.com/')) {
            const pageRes = await fetch(cleanQ, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                }
            });
            if (pageRes.ok) {
                const pageHtml = await pageRes.text();
                const imgMatch = pageHtml.match(/src="(https:\/\/img\.pspkg\.com\/ps4\/image\/[^"]+)"/i) ||
                                 pageHtml.match(/src="(https:\/\/img\.pspkg\.com\/[^"]+\.(?:webp|jpg|png|jpeg))"/i);
                if (imgMatch && imgMatch[1]) {
                    console.log(`🎮 PSPKG رابط مباشر: "${cleanQ}" -> ✅ ${imgMatch[1]}`);
                    return {
                        image: imgMatch[1],
                        description: '',
                        trailer: '',
                        source: 'pspkg',
                        gameName: query
                    };
                }
            }
        }

        // 2. البحث التلقائي في قسم PS4 على pspkg.com
        const searchUrl = `https://pspkg.com/ps4/?search=${encodeURIComponent(cleanQ)}`;
        const res = await fetch(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8'
            }
        });

        if (!res.ok) return null;
        const html = await res.text();

        // استخراج بطاقات الألعاب والصور من pspkg.com
        const imgRegex = /<img[^>]+src="(https:\/\/img\.pspkg\.com\/ps4\/image\/[^"]+)"[^>]*alt="([^"]*)"/gi;
        let match;
        const candidates = [];

        while ((match = imgRegex.exec(html)) !== null) {
            const imgUrl = match[1];
            const altTitle = (match[2] || '').trim();
            candidates.push({ title: altTitle, image: imgUrl });
        }

        if (candidates.length === 0) {
            const genRegex = /src="(https:\/\/img\.pspkg\.com\/ps4\/image\/[^"]+\.(?:webp|jpg|jpeg|png)(?:\?[^"]*)?)"/gi;
            while ((match = genRegex.exec(html)) !== null) {
                candidates.push({ title: '', image: match[1] });
            }
        }

        if (candidates.length === 0) {
            console.log(`🎮 PSPKG: "${cleanQ}" -> ❌ لم يتم العثور على غلاف`);
            return null;
        }

        // اختيار أفضل تطابق مع اسم اللعبة المطلوب
        let bestMatch = candidates[0];
        let bestScore = 0;

        for (const cand of candidates) {
            if (cand.title) {
                const score = nameSimilarity(cleanQ, cand.title);
                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = cand;
                }
            }
        }

        console.log(`🎮 PSPKG: "${cleanQ}" -> "${bestMatch.title || 'Game'}" (${bestScore.toFixed(2)}) -> ✅ ${bestMatch.image}`);
        return {
            image: bestMatch.image,
            description: '',
            trailer: '',
            source: 'pspkg',
            gameName: bestMatch.title || cleanQ
        };
    } catch (e) {
        console.error('PSPKG error:', e.message);
        return null;
    }
}

// ==================== 7. SuperPSX Search ====================
async function searchSuperPSX(query) {
    try {
        let searchQuery = query;
        if (!searchQuery.toLowerCase().includes('ps4')) {
            searchQuery += ' ps4';
        }
        
        const url = `https://www.superpsx.com/?s=${encodeURIComponent(searchQuery)}`;
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/114.0.0.0',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });
        const html = await res.text();
        
        // Find ALL images from the search results
        const regex = /<a[^>]*class="[^"]*penci-image-holder[^"]*"[^>]*>/gi;
        let match;
        const results = [];
        
        while ((match = regex.exec(html)) !== null) {
            const tag = match[0];
            const bgMatch = tag.match(/data-bgset="([^"]+)"/);
            const titleMatch = tag.match(/title="([^"]+)"/);
            
            if (bgMatch && titleMatch) {
                let title = titleMatch[1].replace(/&#[0-9]+;/g, '').replace(/PKG/i, '').replace(/PS4/i, '').trim();
                results.push({
                    image: bgMatch[1],
                    title: title
                });
            }
        }

        if (results.length > 0) {
            let bestMatch = null;
            let bestScore = 0;
            
            for (const item of results) {
                const score = nameSimilarity(query, item.title);
                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = item;
                }
            }

            // Pick the best match if score is reasonable, else default to the first one if we only have 1
            if (bestMatch && (bestScore > 0.4 || results.length === 1)) {
                console.log(`🎮 SuperPSX: "${query}" -> "${bestMatch.title}" (${bestScore.toFixed(2)}) -> ✅`);
                return {
                    image: bestMatch.image,
                    description: '',
                    source: 'superpsx'
                };
            } else if (bestMatch) {
                console.log(`🎮 SuperPSX: "${query}" -> ❌ تشابه ضعيف (${bestScore.toFixed(2)}) مع "${bestMatch.title}"`);
                return null;
            }
        } else {
            // Check for single result redirect or meta tag fallback
            const ogMatch = html.match(/<meta property="og:image"\s+content="([^"]+)"/i);
            if (ogMatch && ogMatch[1] && !ogMatch[1].includes('SUPERPSX-500-x-100-px-OP.png')) {
                console.log(`🎮 SuperPSX: "${query}" -> ✅ Image found (OG Meta)`);
                return {
                    image: ogMatch[1],
                    description: '',
                    source: 'superpsx'
                };
            }
        }

        console.log(`🎮 SuperPSX: "${query}" -> ❌ No image`);
        return null;
    } catch (e) {
        console.error('SuperPSX error:', e.message);
        return null;
    }
}

function cleanGameName(name) {
    if (!name) return '';
    let cleaned = name.toLowerCase();

    // Map common abbreviations
    const abbreviations = {
        'pes': 'pro evolution soccer',
        'fifa': 'ea sports fc', // or just keep fifa for older games
        'gta': 'grand theft auto',
        'cod': 'call of duty',
        're': 'resident evil',
        'nfs': 'need for speed',
        'ac': 'assassin\'s creed',
        'ww2': 'world war 2',
        'mk11': 'mortal kombat 11',
        'mk': 'mortal kombat'
    };

    // Replace strict word matches for abbreviations
    for (const [abbr, full] of Object.entries(abbreviations)) {
        const regex = new RegExp(`\\b${abbr}\\b`, 'g');
        cleaned = cleaned.replace(regex, full);
    }

    // Remove common suffixes that confuse search APIs
    const wordsToRemove = [
        'ps4', 'ps5', 'edition', 'definitive', 'ultimate', 'game of the year', 'goty',
        'remastered', 'remake', 'collection', 'trilogy', 'directors cut', 'director\'s cut',
        'deluxe', 'standard', 'premium', 'gold', 'complete'
    ];

    for (const word of wordsToRemove) {
        const regex = new RegExp(`\\b${word}\\b`, 'g');
        cleaned = cleaned.replace(regex, '');
    }

    // Remove special characters and extra spaces
    cleaned = cleaned.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

    return cleaned || name; // fallback to original if cleaned is empty
}

// ==================== البحث الشامل عن غلاف اللعبة ====================

async function searchGameImage(query, category = 'default') {
    console.log(`\n🔍 البحث عن غلاف اللعبة: "${query}"`);

    let result = {
        image: null,
        description: '',
        trailer: '',
        source: 'none'
    };

    const cleanedQuery = cleanGameName(query);
    console.log(`🧹 الاسم بعد التنظيف: "${cleanedQuery}"`);

    // 0. جرب موقع PSPKG أولاً (أغلفة بلايستيشن 4 أصلية 100%)
    let pspkg = await searchPSPKG(query);
    if (!pspkg || !pspkg.image) {
        pspkg = await searchPSPKG(cleanedQuery);
    }
    if (pspkg && pspkg.image) {
        result = { ...result, ...pspkg };
        console.log(`✅ PSPKG Cover: ${pspkg.image}`);
    }

    // 1. جرب SuperPSX ثانياً
    if (!result.image) {
        let superpsx = await searchSuperPSX(query);
        if (!superpsx || !superpsx.image) {
            superpsx = await searchSuperPSX(cleanedQuery);
        }

        if (superpsx && superpsx.image) {
            result = { ...result, ...superpsx };
            console.log(`✅ SuperPSX Cover`);
        }
    }

    // 1. جرب Steam أولاً
    if (!result.image) {
        let steam = await searchSteam(cleanedQuery);
        if (!steam && cleanedQuery !== query) steam = await searchSteam(query); // fallback to original

        if (steam && steam.image) {
            result = { ...steam };
            console.log(`✅ Steam Cover: ${steam.gameName}`);
        }
    }

    // 2. إذا Steam فشل، جرب RAWG
    if (!result.image) {
        let rawg = await searchRAWG(cleanedQuery);
        if (!rawg && cleanedQuery !== query) rawg = await searchRAWG(query);

        if (rawg && rawg.image) {
            result = { ...rawg };
            console.log(`✅ RAWG Cover: ${rawg.gameName}`);
        }
    }

    // 3. جرب أغلفة Wikipedia الرسمية
    if (!result.image) {
        let wiki = await searchPS4Cover(cleanedQuery);
        if (!wiki && cleanedQuery !== query) wiki = await searchPS4Cover(query);

        if (wiki && wiki.image) {
            result.image = wiki.image;
            result.source = 'wikipedia';
            console.log(`✅ Wikipedia Cover`);
        }
    }

    // 4. جرب Unsplash للأغلفة
    if (!result.image) {
        const unsplash = await searchUnsplash(`${cleanedQuery} PS4 cover boxart`);
        if (unsplash && unsplash.image) {
            result = { ...unsplash };
            console.log(`✅ Unsplash Cover`);
        }
    }

    // 5. يوتيوب (البحث عن التريلر والصورة المصغرة)
    let ytResult = null;
    if (!result.trailer || !result.image) {
        ytResult = await searchYouTube(query);
        if (ytResult) {
            // إضافة التريلر إذا كان مفقوداً
            if (!result.trailer) {
                result.trailer = ytResult.trailer;
                console.log(`✅ YouTube Trailer Added`);
            }
            // استخدام صورة يوتيوب كغلاف أساسي إذا فشلت كل المصادر السابقة
            if (!result.image) {
                result.image = ytResult.thumbnail;
                result.source = 'youtube';
                console.log(`✅ YouTube Thumbnail Cover Added`);
            }
        }
    }

    // 6. صورة غلاف PS4 احتياطية إذا فشل حتى اليوتيوب
    if (!result.image) {
        result.image = getPlaceholderImage(query, category);
        result.source = 'placeholder';
        console.log(`⚠️ Placeholder PS4 Cover`);
    }

    console.log(`📊 المصدر النهائي للغلاف: ${result.source}`);
    return result;
}

// ==================== Routes ====================



// Get all games (public) with pagination and sorting
router.get('/', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 1000;
        const offset = (page - 1) * limit;
        const category = req.query.category;
        const sort = req.query.sort || 'alpha';

        let queryStr = 'SELECT * FROM games';
        let params = [];
        let countQueryStr = 'SELECT COUNT(*) FROM games';
        let countParams = [];

        if (category && category !== 'all') {
            if (category === 'isNew') {
                queryStr += ' WHERE is_new = true';
                countQueryStr += ' WHERE is_new = true';
            } else {
                queryStr += ' WHERE category = $1';
                countQueryStr += ' WHERE category = $1';
                params.push(category);
                countParams.push(category);
            }
        }

        let orderBy = 'ORDER BY LOWER(COALESCE(NULLIF(name_ar, \'\'), name)) ASC';
        if (sort === 'newest') {
            orderBy = 'ORDER BY is_new DESC, created_at DESC';
        } else if (sort === 'price_asc') {
            orderBy = 'ORDER BY price ASC';
        } else if (sort === 'price_desc') {
            orderBy = 'ORDER BY price DESC';
        } else if (sort === 'alpha') {
            orderBy = 'ORDER BY LOWER(COALESCE(NULLIF(name_ar, \'\'), name)) ASC';
        }

        queryStr += ` ${orderBy} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
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
            hardDrive: row.hard_drive,
            isNew: Boolean(row.is_new),
            createdAt: row.created_at
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

// Add new game (Protected) - مع جلب صورة وتصنيف تلقائي وتخزين دائم في DB
router.post('/', verifyToken, async (req, res) => {
    try {
        const { name, nameAr, price, size, category, image, description, trailer, notes, hardDrive, isNew } = req.body;

        if (!name || !price || !size) {
            return res.status(400).json({ error: 'يرجى ملء كافة الحقول الأساسية (الاسم، السعر، الحجم)' });
        }

        const id = 'ps4_' + Date.now().toString().slice(-6);
        const finalNameAr = (nameAr && nameAr.trim() !== '') ? nameAr.trim() : name.trim();
        const finalIsNew = (isNew !== undefined) ? Boolean(isNew) : true;

        let finalDescription = description || '';
        let finalTrailer = trailer || '';
        let finalImage = image ? image.trim() : '';

        // تحديد التصنيف تلقائياً إذا لم يتم اختياره أو تم تركه افتراضي
        let finalCategory = category;
        if (!finalCategory || finalCategory === 'auto' || finalCategory === 'default') {
            finalCategory = autoClassifyGame(name.trim(), finalNameAr, finalDescription);
        }

        if (!finalImage) {
            try {
                const searchResult = await searchGameImage(name, finalCategory);
                if (searchResult && searchResult.image) {
                    finalImage = searchResult.image;
                    if (!finalDescription) finalDescription = searchResult.description || '';
                    if (!finalTrailer) finalTrailer = searchResult.trailer || '';
                    if (!category || category === 'auto' || category === 'default') {
                        finalCategory = searchResult.category || finalCategory;
                    }
                }
            } catch (searchErr) {
                console.warn('Game image search error:', searchErr.message);
            }
        }

        // حفظ الصورة بشكل دائم في قاعدة البيانات (PostgreSQL)
        if (finalImage && !finalImage.includes('placehold.co')) {
            try {
                const dbImagePath = await downloadAndStoreImage(id, finalImage);
                if (dbImagePath) {
                    finalImage = dbImagePath;
                }
            } catch (imgErr) {
                console.warn('Image DB store warning:', imgErr.message);
            }
        }

        if (!finalImage) {
            finalImage = getPlaceholderImage(name, finalCategory);
        }

        await pool.query(
            'INSERT INTO games (id, name, name_ar, price, size, category, image, description, trailer, notes, hard_drive, is_new) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
            [id, name.trim(), finalNameAr, price, size, finalCategory, finalImage, finalDescription, finalTrailer, notes || '', hardDrive || '1', finalIsNew]
        );

        res.json({
            id, name: name.trim(), nameAr: finalNameAr, price, size, category: finalCategory,
            image: finalImage, description: finalDescription,
            trailer: finalTrailer, notes, hardDrive: hardDrive || '1',
            isNew: finalIsNew
        });
    } catch (error) {
        console.error('Error adding game:', error);
        res.status(500).json({ error: 'حدث خطأ في قاعدة البيانات: ' + error.message });
    }
});

// Update game (Protected)
router.put('/:id', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, nameAr, price, size, category, image, description, trailer, notes, hardDrive, isNew } = req.body;

        const isNewParam = (isNew !== undefined) ? Boolean(isNew) : null;
        let finalImage = image;

        // إذا الصورة تم تحديثها برابط خارجي أو base64، احفظها في DB
        if (finalImage && (finalImage.startsWith('http://') || finalImage.startsWith('https://') || finalImage.startsWith('data:image/'))) {
            try {
                const dbImagePath = await downloadAndStoreImage(id, finalImage);
                if (dbImagePath) finalImage = dbImagePath;
            } catch (e) {
                console.warn('Save updated image to DB error:', e.message);
            }
        }

        let finalCat = category;
        if (!finalCat || finalCat === 'auto') {
            finalCat = autoClassifyGame(name, nameAr, description);
        }

        await pool.query(
            'UPDATE games SET name = $1, name_ar = $2, price = $3, size = $4, category = $5, image = $6, description = $7, trailer = $8, notes = $9, hard_drive = $10, is_new = COALESCE($11, is_new) WHERE id = $12',
            [name, nameAr, price, size, finalCat, finalImage, description || '', trailer || '', notes || '', hardDrive || '1', isNewParam, id]
        );

        res.json({ id, name, nameAr, price, size, category: finalCat, image: finalImage, description, trailer, notes, hardDrive: hardDrive || '1', isNew: isNewParam });
    } catch (error) {
        console.error('Error updating game:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Toggle game is_new status (Protected)
router.patch('/:id/toggle-new', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const current = await pool.query('SELECT is_new FROM games WHERE id = $1', [id]);
        if (current.rows.length === 0) {
            return res.status(404).json({ error: 'اللعبة غير موجودة' });
        }
        const newStatus = !current.rows[0].is_new;
        await pool.query('UPDATE games SET is_new = $1 WHERE id = $2', [newStatus, id]);
        res.json({ success: true, isNew: newStatus });
    } catch (error) {
        console.error('Error toggling is_new status:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Delete game (Protected)
router.delete('/:id', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;

        // Delete from game_images table in DB
        await pool.query('DELETE FROM game_images WHERE id = $1', [id]).catch(() => {});

        const gameResult = await pool.query('SELECT image FROM games WHERE id = $1', [id]);
        if (gameResult.rows.length > 0) {
            const imagePath = gameResult.rows[0].image;
            if (imagePath && imagePath.startsWith('/images/games/')) {
                const fullPath = path.join(__dirname, '..', 'public', imagePath);
                if (fs.existsSync(fullPath)) {
                    try { fs.unlinkSync(fullPath); } catch (e) {}
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

// Search game details with Auto-Classification (Protected) - للأدمن
router.get('/search-image', verifyToken, async (req, res) => {
    try {
        const query = req.query.q;
        const category = req.query.category || 'default';
        if (!query) return res.json({ image: null, description: null, trailer: null, category: null });

        console.log(`\n🔍 البحث والتصنيف التلقائي للعبة: "${query}"`);

        const result = await searchGameImage(query, category);

        // Auto-classify game category based on query, description and genres
        const detectedCategory = autoClassifyGame(query, '', result.description || '', result.genres || []);
        result.category = detectedCategory;
        result.detectedCategory = detectedCategory;

        console.log(`✅ النتيجة: source=${result.source}, image=${!!result.image}, category=${detectedCategory}`);

        res.json(result);
    } catch (error) {
        console.error('Search image API error:', error);
        res.json({ image: null, description: null, trailer: null, category: null });
    }
});

// ==================== مسار جلب الصور مباشرة من قاعدة البيانات (PostgreSQL) ====================
// هذا المسار يقدم الصورة مباشرة من قاعدة البيانات مع ترويسة كاش طويلة الأمد
router.get('/image/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // 1. فحص الصورة في جدول game_images بقاعدة البيانات
        const imgRes = await pool.query('SELECT image_data, mime_type, source_url FROM game_images WHERE id = $1', [id]);
        if (imgRes.rows.length > 0 && imgRes.rows[0].image_data) {
            const row = imgRes.rows[0];
            const matches = row.image_data.match(/^data:image\/(\w+);base64,(.+)$/);
            if (matches) {
                const mime = row.mime_type || `image/${matches[1] === 'jpg' ? 'jpeg' : matches[1]}`;
                const buf = Buffer.from(matches[2], 'base64');
                res.set('Content-Type', mime);
                res.set('Cache-Control', 'public, max-age=31536000, immutable');
                return res.send(buf);
            }
        }

        // 2. إذا لم تكن مخزنة في game_images بعد، فحص جدول games
        const gameRes = await pool.query('SELECT image, name, category FROM games WHERE id = $1', [id]);
        if (gameRes.rows.length > 0) {
            const game = gameRes.rows[0];
            if (game.image) {
                // إذا كان رابط خارجي، تحويل المتصفح إليه وتخزينه في الخلفية في DB
                if (game.image.startsWith('http://') || game.image.startsWith('https://')) {
                    downloadAndStoreImage(id, game.image).catch(() => {});
                    return res.redirect(game.image);
                }

                // إذا كان ملفاً محلياً، قراءته وحفظه في DB للأبد
                if (game.image.startsWith('/images/games/')) {
                    const fullPath = path.join(__dirname, '..', 'public', game.image);
                    if (fs.existsSync(fullPath)) {
                        const buf = fs.readFileSync(fullPath);
                        await saveGameImageToDB(id, buf, 'image/jpeg', '');
                        res.set('Content-Type', 'image/jpeg');
                        res.set('Cache-Control', 'public, max-age=31536000, immutable');
                        return res.send(buf);
                    }
                }
            }
        }

        // 3. صورة بديلة افتراضية
        res.redirect('https://placehold.co/400x600/110e20/7c3aed?text=🎮');
    } catch (err) {
        console.error('Serve DB image error:', err.message);
        res.redirect('https://placehold.co/400x600/110e20/7c3aed?text=🎮');
    }
});

// ==================== رفع صورة مخصصة وحفظها في قاعدة البيانات ====================
router.post('/upload-custom-image', verifyToken, async (req, res) => {
    try {
        const { imageData, fileName } = req.body;

        if (!imageData || !imageData.startsWith('data:image/')) {
            return res.status(400).json({ error: 'بيانات الصورة غير صالحة' });
        }

        const matches = imageData.match(/^data:image\/(\w+);base64,(.+)$/);
        if (!matches) {
            return res.status(400).json({ error: 'تنسيق الصورة غير مدعوم' });
        }

        const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
        const mimeType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
        const buffer = Buffer.from(matches[2], 'base64');

        if (buffer.length > 5 * 1024 * 1024) {
            return res.status(400).json({ error: 'حجم الصورة كبير جداً! الحد الأقصى 5MB' });
        }

        const safeName = (fileName || 'custom').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
        const uniqueId = `img_${safeName}_${Date.now().toString().slice(-8)}`;

        // حفظ الصورة مباشرة في جدول game_images بقاعدة البيانات (حفظ أبدي)
        await saveGameImageToDB(uniqueId, imageData, mimeType, '');

        // حفظ كاش محلي أيضاً
        try {
            const filename = `${uniqueId}.${ext}`;
            const filePath = path.join(IMAGES_DIR, filename);
            fs.writeFileSync(filePath, buffer);
        } catch (fsErr) {}

        const permanentDbUrl = `/api/games/image/${uniqueId}`;
        console.log(`💾 تم حفظ الصورة المخصصة في قاعدة البيانات بنجاح: ${permanentDbUrl}`);

        res.json({
            success: true,
            path: permanentDbUrl,
            id: uniqueId
        });
    } catch (error) {
        console.error('Upload custom image error:', error);
        res.status(500).json({ error: 'حدث خطأ أثناء حفظ الصورة في قاعدة البيانات' });
    }
});

// ==================== تصنيف جميع الألعاب تلقائياً (Bulk Auto-Categorize) ====================
router.post('/auto-categorize-all', verifyToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, name, name_ar, description, category FROM games');
        const games = result.rows;
        let updatedCount = 0;
        const categoryCounts = {};

        for (const game of games) {
            const detected = autoClassifyGame(game.name, game.name_ar, game.description);
            categoryCounts[detected] = (categoryCounts[detected] || 0) + 1;

            if (detected !== game.category) {
                await pool.query('UPDATE games SET category = $1 WHERE id = $2', [detected, game.id]);
                updatedCount++;
            }
        }

        res.json({
            success: true,
            message: `تم تصنيف جميع الألعاب بنجاح! تم تحديث تصنيف ${updatedCount} لعبة.`,
            updatedCount,
            totalGames: games.length,
            stats: categoryCounts
        });
    } catch (error) {
        console.error('Auto categorize all error:', error);
        res.status(500).json({ error: 'حدث خطأ أثناء تصنيف الألعاب تلقائياً' });
    }
});

// ==================== مزامنة وحفظ جميع الصور في قاعدة البيانات (DB Image Sync) ====================
// هذا المسار يقوم بتحميل وحفظ جميع صور الألعاب داخل جدول game_images حتى لا تضيع أبداً مع أي تعديل
router.post('/sync-images-to-db', verifyToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, name, name_ar, category, image FROM games');
        const games = result.rows;
        let storedCount = 0;
        let fetchedCount = 0;

        for (const game of games) {
            // فحص هل اللعبة مخزنة مسبقاً في جدول الصور
            const check = await pool.query('SELECT id FROM game_images WHERE id = $1', [game.id]);
            if (check.rows.length > 0) {
                if (game.image !== `/api/games/image/${game.id}`) {
                    await pool.query('UPDATE games SET image = $1 WHERE id = $2', [`/api/games/image/${game.id}`, game.id]);
                }
                storedCount++;
                continue;
            }

            let saved = false;

            // 1. إذا كان رابطاً خارجياً
            if (game.image && (game.image.startsWith('http://') || game.image.startsWith('https://')) && !game.image.includes('placehold.co')) {
                const dl = await downloadImageBuffer(game.image);
                if (dl && dl.buffer) {
                    await saveGameImageToDB(game.id, dl.buffer, dl.contentType, game.image);
                    await pool.query('UPDATE games SET image = $1 WHERE id = $2', [`/api/games/image/${game.id}`, game.id]);
                    saved = true;
                    storedCount++;
                }
            }

            // 2. إذا كان ملفاً محلياً موجوداً على القرص
            if (!saved && game.image && game.image.startsWith('/images/games/')) {
                const fullPath = path.join(__dirname, '..', 'public', game.image);
                if (fs.existsSync(fullPath)) {
                    const buf = fs.readFileSync(fullPath);
                    await saveGameImageToDB(game.id, buf, 'image/jpeg', '');
                    await pool.query('UPDATE games SET image = $1 WHERE id = $2', [`/api/games/image/${game.id}`, game.id]);
                    saved = true;
                    storedCount++;
                }
            }

            // 3. إذا لم تكن الصورة متوفرة، ابحث عنها تلقائياً واحفظها في DB مباشرة
            if (!saved) {
                const searchRes = await searchGameImage(game.name || game.name_ar, game.category);
                if (searchRes && searchRes.image && !searchRes.image.includes('placehold.co')) {
                    const dl = await downloadImageBuffer(searchRes.image);
                    if (dl && dl.buffer) {
                        await saveGameImageToDB(game.id, dl.buffer, dl.contentType, searchRes.image);
                        await pool.query('UPDATE games SET image = $1 WHERE id = $2', [`/api/games/image/${game.id}`, game.id]);
                        fetchedCount++;
                    }
                }
            }
        }

        res.json({
            success: true,
            message: `تم حفظ وتأمين صور ${storedCount + fetchedCount} لعبة داخل قاعدة البيانات بنجاح! الصور الآن محفوظة للأبد.`,
            storedCount,
            fetchedCount,
            total: games.length
        });
    } catch (error) {
        console.error('Sync images to DB error:', error);
        res.status(500).json({ error: 'حدث خطأ أثناء مزامنة وحفظ الصور في قاعدة البيانات' });
    }
});

// Refresh game image (Protected) - مع حفظ دائم في DB
router.post('/refresh-image/:id', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;

        const gameResult = await pool.query('SELECT name, name_ar, category FROM games WHERE id = $1', [id]);
        if (gameResult.rows.length === 0) {
            return res.status(404).json({ error: 'Game not found' });
        }

        const game = gameResult.rows[0];
        const searchQuery = game.name || game.name_ar;

        const searchResult = await searchGameImage(searchQuery, game.category);

        let finalImage = searchResult.image;
        if (finalImage && !finalImage.includes('placehold.co')) {
            const dbImagePath = await downloadAndStoreImage(id, finalImage);
            if (dbImagePath) finalImage = dbImagePath;
        }

        // التصنيف التلقائي
        const detectedCategory = autoClassifyGame(game.name, game.name_ar, searchResult.description || '', searchResult.genres || []);

        await pool.query(
            'UPDATE games SET image = $1, description = $2, trailer = $3, category = $4 WHERE id = $5',
            [finalImage, searchResult.description, searchResult.trailer, detectedCategory, id]
        );

        res.json({
            success: true,
            image: finalImage,
            description: searchResult.description,
            trailer: searchResult.trailer,
            category: detectedCategory,
            source: searchResult.source
        });
    } catch (error) {
        console.error('Refresh image error:', error);
        res.status(500).json({ error: 'Failed to refresh image' });
    }
});

// Get list of games that need refresh
router.get('/needs-refresh', verifyToken, async (req, res) => {
    try {
        const { type } = req.query; // 'images' or 'trailers'

        const result = await pool.query('SELECT id, name, name_ar, image, trailer FROM games');
        const games = result.rows;

        const needsRefresh = [];

        for (const game of games) {
            let isMissing = false;
            if (type === 'images') {
                if (!game.image || game.image.includes('placehold.co')) {
                    isMissing = true;
                } else if (game.image.startsWith('/images/games/')) {
                    const fullPath = path.join(__dirname, '..', 'public', game.image);
                    if (!fs.existsSync(fullPath)) isMissing = true;
                }
            }

            const needsTrailer = type === 'trailers' && !game.trailer;

            if (isMissing || needsTrailer) {
                needsRefresh.push({
                    id: game.id,
                    name: game.name || game.name_ar || 'لعبة مجهولة'
                });
            }
        }

        res.json({ success: true, games: needsRefresh });
    } catch (error) {
        console.error('Needs refresh error:', error);
        res.status(500).json({ error: 'Failed to get games list' });
    }
});

// Refresh a specific game for bulk operations
router.post('/refresh-specific/:id', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { type } = req.body; // 'images' or 'trailers'

        const gameResult = await pool.query('SELECT name, name_ar, category, image, trailer FROM games WHERE id = $1', [id]);
        if (gameResult.rows.length === 0) {
            return res.status(404).json({ error: 'Game not found' });
        }

        const game = gameResult.rows[0];
        const searchQuery = game.name || game.name_ar;
        const searchResult = await searchGameImage(searchQuery, game.category);

        let finalImage = game.image;
        let finalTrailer = game.trailer;

        if (type === 'images' && searchResult.image && !searchResult.image.includes('placehold.co')) {
            const dbImagePath = await downloadAndStoreImage(id, searchResult.image);
            if (dbImagePath) finalImage = dbImagePath;
        }

        if (type === 'trailers' && searchResult.trailer) {
            finalTrailer = searchResult.trailer;
        }

        // التصنيف التلقائي
        const detectedCategory = autoClassifyGame(game.name, game.name_ar, searchResult.description || '', searchResult.genres || []);

        await pool.query(
            'UPDATE games SET image = $1, trailer = $2, category = $3 WHERE id = $4',
            [finalImage, finalTrailer || '', detectedCategory, id]
        );

        res.json({ success: true, category: detectedCategory });
    } catch (error) {
        console.error(`Refresh specific error for ID ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to refresh game' });
    }
});

module.exports = router;
