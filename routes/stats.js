const express = require('express');
const pool = require('../db');
const verifyToken = require('../middleware/auth');
const router = express.Router();

// API: Get stats (Protected)
router.get('/', verifyToken, async (req, res) => {
    try {
        const pendingResult = await pool.query("SELECT COUNT(*) FROM orders WHERE status = 'pending'");
        const completedResult = await pool.query("SELECT COUNT(*) FROM orders WHERE status = 'delivered'");
        const revenueResult = await pool.query('SELECT COALESCE(SUM(total_price), 0) as total FROM orders');
        const gamesResult = await pool.query('SELECT COUNT(*) FROM games');

        res.json({
            pending: parseInt(pendingResult.rows[0].count),
            completed: parseInt(completedResult.rows[0].count),
            revenue: parseInt(revenueResult.rows[0].total),
            totalGames: parseInt(gamesResult.rows[0].count)
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

module.exports = router;
