const express = require('express');
const jwt = require('jsonwebtoken');
const https = require('https');
const pool = require('../db');
const verifyToken = require('../middleware/auth');
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_key_123';

// ─── Helper: Load Store & Telegram Settings from DB ───
async function getStoreSettings() {
    const defaults = {
        telegram_bot_token: process.env.TELEGRAM_BOT_TOKEN || '',
        telegram_chat_id: process.env.TELEGRAM_CHAT_ID || '',
        bundle_enabled: 'true',
        bundle_every_n: '6', // مثلاً: كل 6 ألعاب السادسة مجاناً (أقلها سعراً)
        promo_code: '',
        promo_discount: '0'
    };
    try {
        const res = await pool.query('SELECT key, value FROM system_settings');
        for (const row of res.rows) {
            if (row.key in defaults && row.value !== null) {
                defaults[row.key] = row.value;
            }
        }
    } catch (e) {
        console.warn('getStoreSettings warning:', e.message);
    }
    return defaults;
}

// ─── Helper: Send Telegram Message ───
function sendTelegramMessage(botToken, chatId, text) {
    return new Promise((resolve) => {
        if (!botToken || !chatId) return resolve({ ok: false, error: 'Missing token or chat_id' });

        const payload = JSON.stringify({
            chat_id: chatId.trim(),
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true
        });

        const req = https.request({
            hostname: 'api.telegram.org',
            path: `/bot${botToken.trim()}/sendMessage`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            },
            timeout: 10000
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch {
                    resolve({ ok: false });
                }
            });
        });

        req.on('error', (err) => resolve({ ok: false, error: err.message }));
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Timeout' }); });
        req.write(payload);
        req.end();
    });
}

async function sendTelegramOrderAlert(order, eventType = 'new') {
    try {
        const settings = await getStoreSettings();
        const botToken = settings.telegram_bot_token;
        const chatId = settings.telegram_chat_id;
        if (!botToken || !chatId) return;

        // Group games by Hard Drive for easy installation
        const byDrive = {};
        let totalGB = 0;
        (order.games || []).forEach(g => {
            const hd = g.hardDrive || g.hard_drive || '1';
            if (!byDrive[hd]) byDrive[hd] = [];
            byDrive[hd].push(g);
            const m = String(g.size || '').match(/([\d.]+)/);
            if (m) {
                let val = parseFloat(m[1]);
                const low = String(g.size).toLowerCase();
                if (low.includes('tb') || low.includes('ت')) val *= 1024;
                else if (low.includes('mb') || low.includes('م')) val /= 1024;
                totalGB += val;
            }
        });

        const sortedDrives = Object.keys(byDrive).sort((a, b) => Number(a) - Number(b));
        const gamesFormatted = sortedDrives.map(hd => {
            const list = byDrive[hd].map(g => `   • ${g.name_ar || g.nameAr || g.name} (${g.size || '—'})`).join('\n');
            return `💿 <b>هارد ${hd}:</b>\n${list}`;
        }).join('\n\n');

        const header = eventType === 'new'
            ? `🔔 <b>طلب جديد في متجر NewLife!</b>`
            : `✏️ <b>تعديل طلب من الزبون (#${order.orderId})</b>`;

        const finalPrice = Math.max(0, (parseFloat(order.totalPrice) || 0) - (parseFloat(order.discount) || 0));
        let cleanPhone = String(order.customerPhone || '').replace(/[^0-9]/g, '');
        if (cleanPhone.startsWith('07')) cleanPhone = '964' + cleanPhone.slice(1);

        const msg = `${header}\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `🧾 <b>رقم الطلب:</b> <code>#${order.orderId}</code>\n` +
            `👤 <b>الزبون:</b> ${order.customerName}\n` +
            `📱 <b>الهاتف:</b> <code>${order.customerPhone}</code>\n` +
            (order.notes ? `📝 <b>ملاحظات:</b> ${order.notes}\n` : '') +
            `━━━━━━━━━━━━━━━━━━\n` +
            `🎮 <b>الألعاب المطلوبة (${(order.games || []).length}):</b>\n\n${gamesFormatted}\n\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `💾 <b>إجمالي الحجم:</b> ${totalGB > 0 ? totalGB.toFixed(1) + ' GB' : 'غير محدد'}\n` +
            (order.discount > 0 ? `🎁 <b>الخصم:</b> ${Number(order.discount).toLocaleString()} د.ع\n` : '') +
            `💰 <b>المبلغ النهائي:</b> <b>${finalPrice.toLocaleString()} دينار</b>\n\n` +
            `💬 <a href="https://wa.me/${cleanPhone}">فتح محادثة واتساب مع الزبون</a>`;

        await sendTelegramMessage(botToken, chatId, msg);
    } catch (e) {
        console.warn('Telegram alert error:', e.message);
    }
}

// ─── Helper: Validate Games Prices & Info from DB ───
async function validateAndEnrichGames(clientOrPool, rawGames) {
    if (!Array.isArray(rawGames) || rawGames.length === 0) return [];
    const ids = rawGames.map(g => g.id).filter(Boolean);
    const dbMap = new Map();

    if (ids.length > 0) {
        const dbRes = await clientOrPool.query(
            'SELECT id, name, name_ar, price, size, hard_drive, image FROM games WHERE id = ANY($1)',
            [ids]
        );
        dbRes.rows.forEach(r => dbMap.set(r.id, r));
    }

    // Remove duplicate game IDs in the same order
    const seenIds = new Set();
    const enriched = [];

    for (const item of rawGames) {
        const key = item.id || item.name;
        if (key && seenIds.has(key)) continue;
        if (key) seenIds.add(key);

        const dbGame = item.id ? dbMap.get(item.id) : null;
        if (dbGame) {
            enriched.push({
                id: dbGame.id,
                name: dbGame.name,
                name_ar: dbGame.name_ar || dbGame.name,
                nameAr: dbGame.name_ar || dbGame.name,
                price: parseFloat(dbGame.price) || 0,
                size: dbGame.size || item.size || '',
                hardDrive: dbGame.hard_drive || item.hardDrive || item.hard_drive || '1',
                image: dbGame.image || item.image || ''
            });
        } else {
            enriched.push({
                id: item.id || '',
                name: item.name || '',
                name_ar: item.name_ar || item.nameAr || item.name || '',
                nameAr: item.nameAr || item.name_ar || item.name || '',
                price: Math.max(0, parseFloat(item.price) || 0),
                size: item.size || '',
                hardDrive: item.hardDrive || item.hard_drive || '1',
                image: item.image || ''
            });
        }
    }

    return enriched;
}

// ─── Public Store Offer & Bundle Config ───
router.get('/settings/public', async (req, res) => {
    try {
        const s = await getStoreSettings();
        res.json({
            bundleEnabled: s.bundle_enabled === 'true',
            bundleEveryN: parseInt(s.bundle_every_n) || 6,
            hasPromoCode: Boolean(s.promo_code && s.promo_code.trim() !== '')
        });
    } catch (e) {
        res.json({ bundleEnabled: true, bundleEveryN: 6, hasPromoCode: false });
    }
});

// ─── Verify Promo Code (Public) ───
router.post('/settings/verify-promo', async (req, res) => {
    try {
        const { code } = req.body;
        if (!code) return res.status(400).json({ valid: false, message: 'يرجى إدخال كود الخصم' });
        const s = await getStoreSettings();
        if (s.promo_code && s.promo_code.trim().toLowerCase() === code.trim().toLowerCase()) {
            const discount = parseInt(s.promo_discount) || 0;
            return res.json({ valid: true, discount, code: s.promo_code.trim() });
        }
        return res.status(400).json({ valid: false, message: 'كود الخصم غير صالح أو منتهي الصلاحية' });
    } catch (e) {
        res.status(500).json({ valid: false, message: 'خطأ في التحقق من الكود' });
    }
});

// ─── Admin Store & Telegram Settings ───
router.get('/settings/config', verifyToken, async (req, res) => {
    try {
        const s = await getStoreSettings();
        res.json(s);
    } catch (e) {
        res.status(500).json({ error: 'Failed to load settings' });
    }
});

router.post('/settings/config', verifyToken, async (req, res) => {
    try {
        const allowedKeys = [
            'telegram_bot_token',
            'telegram_chat_id',
            'bundle_enabled',
            'bundle_every_n',
            'promo_code',
            'promo_discount'
        ];
        for (const key of allowedKeys) {
            if (req.body[key] !== undefined) {
                await pool.query(
                    `INSERT INTO system_settings (key, value) VALUES ($1, $2)
                     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
                    [key, String(req.body[key]).trim()]
                );
            }
        }
        res.json({ success: true, message: 'تم حفظ الإعدادات بنجاح' });
    } catch (e) {
        console.error('Save settings error:', e);
        res.status(500).json({ error: 'فشل حفظ الإعدادات' });
    }
});

router.post('/settings/test-telegram', verifyToken, async (req, res) => {
    try {
        const { telegram_bot_token, telegram_chat_id } = req.body;
        const s = await getStoreSettings();
        const token = telegram_bot_token !== undefined ? telegram_bot_token : s.telegram_bot_token;
        const chatId = telegram_chat_id !== undefined ? telegram_chat_id : s.telegram_chat_id;

        if (!token || !chatId) {
            return res.status(400).json({ error: 'يرجى إدخال Bot Token و Chat ID أولاً' });
        }

        const result = await sendTelegramMessage(
            token,
            chatId,
            `✅ <b>تجربة إشعار ناجحة من متجر NewLife!</b>\nسيتم إرسال كافة الطلبات الجديدة وتعديلات الزبائن إلى هذا الحساب فوراً 🎮🔥`
        );

        if (result && result.ok) {
            return res.json({ success: true, message: 'تم إرسال الرسالة التجريبية إلى التلكرام بنجاح!' });
        }
        return res.status(400).json({ error: 'فشل الإرسال: تأكد من صحة التوكن والـ Chat ID وأنك ضغطت Start في البوت' });
    } catch (e) {
        res.status(500).json({ error: 'حدث خطأ أثناء الاتصال بالتلكرام' });
    }
});

// Get orders (Public if phone query parameter provided, Admin JWT verified if fetching all)
router.get('/', async (req, res) => {
    try {
        const { phone } = req.query;

        let queryStr = 'SELECT * FROM orders';
        let params = [];

        if (phone && phone.trim() !== '') {
            queryStr += ' WHERE customer_phone = $1 ORDER BY created_at DESC';
            params.push(phone.trim());
        } else {
            // Require and verify Admin JWT Token if requesting all orders without phone filter
            const authHeader = req.headers['authorization'];
            const tokenPart = authHeader && authHeader.split(' ')[1];
            if (!tokenPart) {
                return res.status(403).json({ error: 'Access denied. Phone number or Admin Token required.' });
            }
            try {
                jwt.verify(tokenPart, process.env.JWT_SECRET);
            } catch (err) {
                return res.status(401).json({ error: 'Invalid or expired Admin Token.' });
            }
            queryStr += ' ORDER BY created_at DESC';
        }

        const result = await pool.query(queryStr, params);

        // Transform to match panel format
        const orders = result.rows.map(row => ({
            orderId: row.order_id,
            customerName: row.customer_name,
            customerPhone: row.customer_phone,
            customerAddress: row.customer_address || '',
            notes: row.notes,
            games: typeof row.games === 'string' ? JSON.parse(row.games) : row.games,
            totalPrice: parseFloat(row.total_price),
            status: row.status,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            completedGames: row.completed_games || [],
            cancelledGames: row.cancelled_games || [],
            adminNotes: row.admin_notes || '',
            discount: row.discount || 0,
            pointsAwarded: row.points_awarded || false
        }));

        res.json({ data: orders });
    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get orders statistics (Admin)
router.get('/stats/overview', verifyToken, async (req, res) => {
    try {
        const totalResult = await pool.query('SELECT COUNT(*) FROM orders');
        const pendingResult = await pool.query("SELECT COUNT(*) FROM orders WHERE status = 'pending'");
        const confirmedResult = await pool.query("SELECT COUNT(*) FROM orders WHERE status = 'confirmed'");
        const deliveredResult = await pool.query("SELECT COUNT(*) FROM orders WHERE status = 'delivered'");
        const revenueResult = await pool.query("SELECT COALESCE(SUM(total_price - COALESCE(discount, 0)), 0) FROM orders WHERE status != 'cancelled'");

        res.json({
            total: parseInt(totalResult.rows[0].count),
            pending: parseInt(pendingResult.rows[0].count),
            confirmed: parseInt(confirmedResult.rows[0].count),
            delivered: parseInt(deliveredResult.rows[0].count),
            revenue: parseFloat(revenueResult.rows[0].coalesce)
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get single order
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM orders WHERE order_id = $1', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }

        const row = result.rows[0];
        const order = {
            orderId: row.order_id,
            customerName: row.customer_name,
            customerPhone: row.customer_phone,
            customerAddress: row.customer_address || '',
            notes: row.notes,
            games: typeof row.games === 'string' ? JSON.parse(row.games) : row.games,
            totalPrice: parseFloat(row.total_price),
            status: row.status,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            completedGames: row.completed_games || [],
            cancelledGames: row.cancelled_games || [],
            adminNotes: row.admin_notes || '',
            discount: row.discount || 0,
            pointsAwarded: row.points_awarded || false
        };

        res.json(order);
    } catch (error) {
        console.error('Error fetching order:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Create new order (Customer)
router.post('/', async (req, res) => {
    try {
        const { customer_name, customer_phone, customer_address, notes, games, use_points, promo_code } = req.body;

        if (!customer_name || !customer_phone || !games || !Array.isArray(games) || games.length === 0) {
            return res.status(400).json({ error: 'يرجى إدخال الاسم ورقم الهاتف واختيار لعبة واحدة على الأقل' });
        }

        const cleanPhone = customer_phone.trim();
        const cleanName = customer_name.trim();
        const orderId = 'ORD-' + Date.now().toString().slice(-6);

        const settings = await getStoreSettings();
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // 1. Validate & enrich games from DB so prices cannot be manipulated
            const validatedGames = await validateAndEnrichGames(client, games);
            const subtotalPrice = validatedGames.reduce((sum, g) => sum + (parseFloat(g.price) || 0), 0);

            // 2. Calculate automatic bundle discount if enabled (e.g. every Nth game is free)
            let bundleDiscount = 0;
            const bundleEveryN = parseInt(settings.bundle_every_n) || 0;
            if (settings.bundle_enabled === 'true' && bundleEveryN >= 2 && validatedGames.length >= bundleEveryN) {
                const freeCount = Math.floor(validatedGames.length / bundleEveryN);
                const sortedPrices = validatedGames.map(g => parseFloat(g.price) || 0).sort((a, b) => a - b);
                for (let i = 0; i < freeCount; i++) {
                    bundleDiscount += sortedPrices[i] || 0;
                }
            }

            // 3. Calculate promo code discount if provided
            let promoDiscount = 0;
            if (promo_code && settings.promo_code && promo_code.trim().toLowerCase() === settings.promo_code.trim().toLowerCase()) {
                promoDiscount = Math.max(0, parseInt(settings.promo_discount) || 0);
            }

            // 4. Insert or update customer & handle loyalty points
            const custRes = await client.query('SELECT points FROM customers WHERE phone = $1 FOR UPDATE', [cleanPhone]);
            let currentPoints = 0;
            if (custRes.rows.length === 0) {
                await client.query('INSERT INTO customers (phone, name, points) VALUES ($1, $2, 0)', [cleanPhone, cleanName]);
            } else {
                currentPoints = parseInt(custRes.rows[0].points) || 0;
                await client.query('UPDATE customers SET name = $1 WHERE phone = $2', [cleanName, cleanPhone]);
            }

            let pointsDiscount = 0;
            let pointsDeducted = 0;
            const remainingAfterPromos = Math.max(0, subtotalPrice - bundleDiscount - promoDiscount);

            if (use_points && currentPoints > 0 && remainingAfterPromos > 0) {
                const maxPossibleDiscount = currentPoints * 100; // 1 point = 100 IQD
                pointsDiscount = Math.min(remainingAfterPromos, maxPossibleDiscount);
                pointsDeducted = Math.floor(pointsDiscount / 100);
                pointsDiscount = pointsDeducted * 100;

                if (pointsDeducted > 0) {
                    await client.query(
                        'UPDATE customers SET points = GREATEST(0, points - $1) WHERE phone = $2',
                        [pointsDeducted, cleanPhone]
                    );
                }
            }

            const totalDiscount = Math.min(subtotalPrice, bundleDiscount + promoDiscount + pointsDiscount);

            // 5. Create order
            await client.query(
                `INSERT INTO orders (order_id, customer_name, customer_phone, customer_address, notes, games, total_price, discount, status, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
                [
                    orderId,
                    cleanName,
                    cleanPhone,
                    customer_address || '',
                    notes || '',
                    JSON.stringify(validatedGames),
                    subtotalPrice,
                    totalDiscount,
                    'pending'
                ]
            );

            await client.query('COMMIT');

            // Trigger non-blocking Telegram notification
            sendTelegramOrderAlert({
                orderId,
                customerName: cleanName,
                customerPhone: cleanPhone,
                notes: notes || '',
                games: validatedGames,
                totalPrice: subtotalPrice,
                discount: totalDiscount
            }, 'new');

            res.json({
                success: true,
                order_id: orderId,
                total_price: subtotalPrice,
                discount: totalDiscount,
                final_price: Math.max(0, subtotalPrice - totalDiscount),
                points_deducted: pointsDeducted,
                message: 'Order created successfully'
            });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error creating order:', error);
        res.status(500).json({ error: 'Database error: ' + error.message });
    }
});

// Helper for order update logic
async function updateOrderLogic(id, updateData, res) {
    try {
        const checkResult = await pool.query('SELECT status FROM orders WHERE order_id = $1', [id]);
        if (checkResult.rows.length === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }

        const fields = [];
        const values = [];
        let paramIndex = 1;

        if (updateData.customerName !== undefined) {
            fields.push(`customer_name = $${paramIndex++}`);
            values.push(updateData.customerName);
        }
        if (updateData.customerPhone !== undefined) {
            fields.push(`customer_phone = $${paramIndex++}`);
            values.push(updateData.customerPhone);
        }
        if (updateData.notes !== undefined) {
            fields.push(`notes = $${paramIndex++}`);
            values.push(updateData.notes);
        }
        if (updateData.games !== undefined) {
            fields.push(`games = $${paramIndex++}`);
            values.push(JSON.stringify(updateData.games));
        }
        if (updateData.totalPrice !== undefined) {
            fields.push(`total_price = $${paramIndex++}`);
            values.push(updateData.totalPrice);
        }
        if (updateData.discount !== undefined) {
            fields.push(`discount = $${paramIndex++}`);
            values.push(updateData.discount);
        }
        if (updateData.status !== undefined) {
            fields.push(`status = $${paramIndex++}`);
            values.push(updateData.status);
        }
        if (updateData.completedGames !== undefined) {
            fields.push(`completed_games = $${paramIndex++}`);
            values.push(JSON.stringify(updateData.completedGames));
        }
        if (updateData.cancelledGames !== undefined) {
            fields.push(`cancelled_games = $${paramIndex++}`);
            values.push(JSON.stringify(updateData.cancelledGames));
        }
        if (updateData.adminNotes !== undefined) {
            fields.push(`admin_notes = $${paramIndex++}`);
            values.push(updateData.adminNotes);
        }

        if (fields.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        fields.push(`updated_at = NOW()`);
        values.push(id);
        const query = `UPDATE orders SET ${fields.join(', ')} WHERE order_id = $${paramIndex} RETURNING *`;

        const result = await pool.query(query, values);

        // Award points if status changed to delivered
        if (updateData.status === 'delivered') {
            const order = result.rows[0];
            if (order && !order.points_awarded) {
                const netPaid = Math.max(0, (parseFloat(order.total_price) || 0) - (parseFloat(order.discount) || 0));
                const pointsToAward = Math.floor(netPaid / 1000); // 1 point per 1000 IQD spent
                if (pointsToAward > 0) {
                    await pool.query('UPDATE customers SET points = points + $1 WHERE phone = $2', [pointsToAward, order.customer_phone]);
                }
                await pool.query('UPDATE orders SET points_awarded = true WHERE order_id = $1', [id]);
            }
        }

        res.json({ success: true, message: 'Order updated successfully' });
    } catch (error) {
        console.error('Error updating order:', error);
        res.status(500).json({ error: 'Database error' });
    }
}

// Update order (Admin protected)
router.put('/:id', verifyToken, async (req, res) => {
    await updateOrderLogic(req.params.id, req.body, res);
});

// Update order status specifically (Admin protected)
router.put('/:id/status', verifyToken, async (req, res) => {
    await updateOrderLogic(req.params.id, { status: req.body.status }, res);
});

// ─── تعديل ألعاب الطلب من قِبَل الزبون (مع التحقق من الأسعار من قاعدة البيانات) ───
router.put('/:id/customer-update', async (req, res) => {
    try {
        const { id } = req.params;
        const { phone, games } = req.body;

        if (!phone || !games || !Array.isArray(games)) {
            return res.status(400).json({ error: 'البيانات ناقصة' });
        }

        if (games.length === 0) {
            return res.status(400).json({ error: 'يجب أن يحتوي الطلب على لعبة واحدة على الأقل' });
        }

        const checkResult = await pool.query(
            'SELECT status, customer_phone, customer_name, notes, discount FROM orders WHERE order_id = $1',
            [id]
        );

        if (checkResult.rows.length === 0) {
            return res.status(404).json({ error: 'الطلب غير موجود' });
        }

        const order = checkResult.rows[0];

        if (order.customer_phone !== phone.trim()) {
            return res.status(403).json({ error: 'رقم الهاتف غير مطابق لصاحب الطلب' });
        }

        if (order.status !== 'pending') {
            return res.status(400).json({ error: 'لا يمكن تعديل الطلب بعد تأكيده من قِبَل المتجر' });
        }

        // Validate prices from DB
        const validatedGames = await validateAndEnrichGames(pool, games);
        const totalPrice = validatedGames.reduce((sum, g) => sum + (parseFloat(g.price) || 0), 0);

        // Recalculate bundle discount if applicable
        const settings = await getStoreSettings();
        let newDiscount = order.discount || 0;
        const bundleEveryN = parseInt(settings.bundle_every_n) || 0;
        if (settings.bundle_enabled === 'true' && bundleEveryN >= 2) {
            const freeCount = Math.floor(validatedGames.length / bundleEveryN);
            const sortedPrices = validatedGames.map(g => parseFloat(g.price) || 0).sort((a, b) => a - b);
            let bundleDisc = 0;
            for (let i = 0; i < freeCount; i++) bundleDisc += sortedPrices[i] || 0;
            newDiscount = Math.min(totalPrice, bundleDisc);
        }

        await pool.query(
            'UPDATE orders SET games = $1, total_price = $2, discount = $3, updated_at = NOW() WHERE order_id = $4',
            [JSON.stringify(validatedGames), totalPrice, newDiscount, id]
        );

        sendTelegramOrderAlert({
            orderId: id,
            customerName: order.customer_name,
            customerPhone: order.customer_phone,
            notes: order.notes || '',
            games: validatedGames,
            totalPrice,
            discount: newDiscount
        }, 'edit');

        res.json({ success: true, totalPrice, discount: newDiscount, message: 'تم تعديل طلبك بنجاح' });
    } catch (error) {
        console.error('Error updating order by customer:', error);
        res.status(500).json({ error: 'حدث خطأ في السيرفر' });
    }
});

// Cancel order (Customer with phone verification or Admin)
router.post('/:id/cancel', async (req, res) => {
    try {
        const { id } = req.params;
        const { phone } = req.body || {};

        const checkResult = await pool.query(
            'SELECT status, customer_phone FROM orders WHERE order_id = $1',
            [id]
        );
        if (checkResult.rows.length === 0) {
            return res.status(404).json({ error: 'الطلب غير موجود' });
        }

        const order = checkResult.rows[0];

        // Verify ownership by phone OR valid Admin JWT
        let isAuthorized = false;
        if (phone && phone.trim() === order.customer_phone) {
            isAuthorized = true;
        } else if (req.headers['authorization']) {
            const tokenPart = req.headers['authorization'].split(' ')[1];
            try {
                jwt.verify(tokenPart, process.env.JWT_SECRET);
                isAuthorized = true;
            } catch {}
        }

        if (!isAuthorized) {
            return res.status(403).json({ error: 'غير مصرح لك بإلغاء هذا الطلب' });
        }

        if (order.status !== 'pending') {
            return res.status(400).json({ error: 'لا يمكن إلغاء الطلب بعد تأكيده' });
        }

        await pool.query(
            "UPDATE orders SET status = 'cancelled', updated_at = NOW() WHERE order_id = $1",
            [id]
        );

        res.json({ success: true, message: 'تم إلغاء الطلب بنجاح' });
    } catch (error) {
        console.error('Error cancelling order:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Delete order (Admin only)
router.delete('/:id', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM orders WHERE order_id = $1', [id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting order:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

module.exports = router;
