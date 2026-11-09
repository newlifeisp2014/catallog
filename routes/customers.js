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

// Update customer points or name (Admin protected)
router.put('/:phone', verifyToken, async (req, res) => {
    try {
        const { phone } = req.params;
        const { name, points } = req.body;
        const check = await pool.query('SELECT * FROM customers WHERE phone = $1', [phone]);
        if (check.rows.length === 0) {
            return res.status(404).json({ error: 'الزبون غير موجود' });
        }
        const updatedName = name !== undefined ? name.trim() : check.rows[0].name;
        const updatedPoints = points !== undefined ? Math.max(0, parseInt(points) || 0) : check.rows[0].points;

        await pool.query(
            'UPDATE customers SET name = $1, points = $2 WHERE phone = $3',
            [updatedName, updatedPoints, phone]
        );
        res.json({ success: true, phone, name: updatedName, points: updatedPoints });
    } catch (error) {
        console.error('Error updating customer:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

module.exports = router;
