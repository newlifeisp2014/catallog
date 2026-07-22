const express = require('express');
const pool = require('../db');
const verifyToken = require('../middleware/auth');
const router = express.Router();

// Get all customers (Admin protected)
router.get('/', verifyToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT phone, name, points, created_at FROM customers ORDER BY points DESC, created_at DESC');
        res.json({ data: result.rows });
    } catch (error) {
        console.error('Error fetching customers list:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get customer points by phone
router.get('/:phone', async (req, res) => {
    try {
        const { phone } = req.params;
        const result = await pool.query('SELECT name, points FROM customers WHERE phone = $1', [phone]);
        
        if (result.rows.length === 0) {
            return res.json({ phone, points: 0, exists: false });
        }
        
        res.json({ phone, name: result.rows[0].name, points: result.rows[0].points, exists: true });
    } catch (error) {
        console.error('Error fetching customer:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

module.exports = router;
