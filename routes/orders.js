const express = require('express');
const pool = require('../db');
const verifyToken = require('../middleware/auth');
const router = express.Router();

// Get orders (Public if phone query parameter provided, Admin required if fetching all)
router.get('/', async (req, res) => {
    try {
        const { phone } = req.query;

        let queryStr = 'SELECT * FROM orders';
        let params = [];

        if (phone && phone.trim() !== '') {
            queryStr += ' WHERE customer_phone = $1 ORDER BY created_at DESC';
            params.push(phone.trim());
        } else {
            // Requiring Admin Auth if requesting all orders without phone filter
            const authHeader = req.headers['authorization'];
            if (!authHeader) {
                return res.status(403).json({ error: 'Access denied. Phone number or Admin Token required.' });
            }
            queryStr += ' ORDER BY created_at DESC';
        }

        const result = await pool.query(queryStr, params);

        // Transform to match panel format
        const orders = result.rows.map(row => ({
            orderId: row.order_id,
            customerName: row.customer_name,
            customerPhone: row.customer_phone,
            notes: row.notes,
            games: typeof row.games === 'string' ? JSON.parse(row.games) : row.games,
            totalPrice: parseFloat(row.total_price),
            status: row.status,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            completedGames: row.completed_games || [],
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
            notes: row.notes,
            games: typeof row.games === 'string' ? JSON.parse(row.games) : row.games,
            totalPrice: parseFloat(row.total_price),
            status: row.status,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            completedGames: row.completed_games || [],
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
        const { customer_name, customer_phone, customer_address, notes, games, total_price, discount, use_points } = req.body;

        if (!customer_name || !customer_phone || !games || games.length === 0) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const orderId = 'ORD-' + Date.now().toString().slice(-6);
        const appliedDiscount = discount || 0;

        // Start transaction for creating order & handling points
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Insert or update customer
            const custRes = await client.query('SELECT points FROM customers WHERE phone = $1', [customer_phone]);
            let currentPoints = 0;
            if (custRes.rows.length === 0) {
                await client.query('INSERT INTO customers (phone, name, points) VALUES ($1, $2, 0)', [customer_phone, customer_name]);
            } else {
                currentPoints = custRes.rows[0].points;
            }

            // 2. Deduct points if used
            if (use_points && appliedDiscount > 0) {
                const pointsToDeduct = Math.floor(appliedDiscount / 100); // 1 point = 100 IQD discount
                if (currentPoints >= pointsToDeduct) {
                    await client.query('UPDATE customers SET points = points - $1 WHERE phone = $2', [pointsToDeduct, customer_phone]);
                }
            }

            // 3. Create order
            await client.query(
                `INSERT INTO orders (order_id, customer_name, customer_phone, customer_address, notes, games, total_price, discount, status, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
                [orderId, customer_name, customer_phone, customer_address || '', notes || '', JSON.stringify(games), total_price, appliedDiscount, 'pending']
            );

            await client.query('COMMIT');
            res.json({ 
                success: true, 
                order_id: orderId,
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
        if (updateData.status !== undefined) {
            fields.push(`status = $${paramIndex++}`);
            values.push(updateData.status);
        }
        if (updateData.completedGames !== undefined) {
            fields.push(`completed_games = $${paramIndex++}`);
            values.push(JSON.stringify(updateData.completedGames));
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
                const pointsToAward = Math.floor(parseFloat(order.total_price) / 1000); // 1 point per 1000 IQD spent
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

// Cancel order (Customer)
router.post('/:id/cancel', async (req, res) => {
    try {
        const { id } = req.params;

        const checkResult = await pool.query('SELECT status FROM orders WHERE order_id = $1', [id]);
        if (checkResult.rows.length === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (checkResult.rows[0].status !== 'pending') {
            return res.status(400).json({ error: 'Can only cancel pending orders' });
        }

        await pool.query(
            "UPDATE orders SET status = 'cancelled', updated_at = NOW() WHERE order_id = $1",
            [id]
        );

        res.json({ success: true, message: 'Order cancelled successfully' });
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

// Get orders statistics (Admin)
router.get('/stats/overview', verifyToken, async (req, res) => {
    try {
        const totalResult = await pool.query('SELECT COUNT(*) FROM orders');
        const pendingResult = await pool.query("SELECT COUNT(*) FROM orders WHERE status = 'pending'");
        const confirmedResult = await pool.query("SELECT COUNT(*) FROM orders WHERE status = 'confirmed'");
        const deliveredResult = await pool.query("SELECT COUNT(*) FROM orders WHERE status = 'delivered'");
        const revenueResult = await pool.query("SELECT COALESCE(SUM(total_price), 0) FROM orders WHERE status != 'cancelled'");

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

module.exports = router;
