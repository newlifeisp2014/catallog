const express = require('express');
const pool = require('../db');
const verifyToken = require('../middleware/auth');
const router = express.Router();

// API: Get stats with Top Games & Trends (Protected)
router.get('/', verifyToken, async (req, res) => {
    try {
        const pendingResult = await pool.query("SELECT COUNT(*) FROM orders WHERE status = 'pending'");
        const completedResult = await pool.query("SELECT COUNT(*) FROM orders WHERE status = 'delivered'");
        const confirmedResult = await pool.query("SELECT COUNT(*) FROM orders WHERE status = 'confirmed'");
        const totalOrdersResult = await pool.query("SELECT COUNT(*) FROM orders");
        const revenueResult = await pool.query('SELECT COALESCE(SUM(total_price), 0) as total FROM orders WHERE status != \'cancelled\'');
        const gamesResult = await pool.query('SELECT COUNT(*) FROM games');

        // الألعاب الأكثر طلباً في المحل
        let topGames = [];
        try {
            const topGamesResult = await pool.query(`
                SELECT 
                    COALESCE(NULLIF(elem->>'name_ar', ''), elem->>'name') as title,
                    elem->>'name' as original_name,
                    COUNT(*) as count
                FROM orders, jsonb_array_elements(games) as elem
                WHERE status != 'cancelled'
                GROUP BY title, original_name
                ORDER BY count DESC
                LIMIT 10
            `);
            topGames = topGamesResult.rows.map(r => ({
                name: r.title,
                originalName: r.original_name,
                count: parseInt(r.count)
            }));
        } catch (topErr) {
            console.warn('Top games query notice:', topErr.message);
        }

        res.json({
            pending: parseInt(pendingResult.rows[0].count),
            confirmed: parseInt(confirmedResult.rows[0].count),
            completed: parseInt(completedResult.rows[0].count),
            totalOrders: parseInt(totalOrdersResult.rows[0].count),
            revenue: parseInt(revenueResult.rows[0].total),
            totalGames: parseInt(gamesResult.rows[0].count),
            topGames: topGames
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

module.exports = router;
