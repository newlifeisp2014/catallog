const express = require('express');
const pool = require('../db');
const jwt = require('jsonwebtoken');
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_key_123';

// Generate 4-digit OTP
function generateOTP() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

// 1. Request OTP
router.post('/send-otp', async (req, res) => {
    try {
        const { phone } = req.body;
        
        if (!phone || phone.length < 10) {
            return res.status(400).json({ error: 'رقم الهاتف غير صالح' });
        }

        const otpCode = generateOTP();
        // OTP valid for 5 minutes
        const otpExpiry = new Date(Date.now() + 5 * 60000); 

        // Check if customer exists
        const result = await pool.query('SELECT * FROM customers WHERE phone = $1', [phone]);
        
        if (result.rows.length === 0) {
            // New customer, insert with placeholder name
            await pool.query(
                'INSERT INTO customers (phone, name, otp_code, otp_expiry) VALUES ($1, $2, $3, $4)', 
                [phone, 'زبون جديد', otpCode, otpExpiry]
            );
        } else {
            // Existing customer, update OTP
            await pool.query(
                'UPDATE customers SET otp_code = $1, otp_expiry = $2 WHERE phone = $3', 
                [otpCode, otpExpiry, phone]
            );
        }

        // MOCK SEND SMS: Print to console
        console.log(`\n========================================`);
        console.log(`📱 MOCK SMS TO: ${phone}`);
        console.log(`🔑 OTP CODE: ${otpCode}`);
        console.log(`========================================\n`);

        res.json({ success: true, message: 'تم إرسال رمز التحقق (للتجربة: انظر إلى كونسول الخادم)' });
    } catch (error) {
        console.error('Error sending OTP:', error);
        res.status(500).json({ error: 'حدث خطأ في السيرفر' });
    }
});

// 2. Verify OTP
router.post('/verify-otp', async (req, res) => {
    try {
        const { phone, code, name } = req.body;

        if (!phone || !code) {
            return res.status(400).json({ error: 'البيانات ناقصة' });
        }

        const result = await pool.query('SELECT * FROM customers WHERE phone = $1', [phone]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'الحساب غير موجود' });
        }

        const customer = result.rows[0];

        if (customer.otp_code !== code) {
            return res.status(400).json({ error: 'الرمز غير صحيح' });
        }

        if (new Date() > new Date(customer.otp_expiry)) {
            return res.status(400).json({ error: 'انتهت صلاحية الرمز، يرجى طلب رمز جديد' });
        }

        // Update name if provided (e.g. for new customers)
        let finalName = customer.name;
        if (name && name.trim() !== '' && customer.name === 'زبون جديد') {
            finalName = name.trim();
            await pool.query('UPDATE customers SET name = $1 WHERE phone = $2', [finalName, phone]);
        }

        // Clear OTP after successful login
        await pool.query('UPDATE customers SET otp_code = NULL, otp_expiry = NULL WHERE phone = $1', [phone]);

        // Generate JWT token
        const token = jwt.sign(
            { phone: customer.phone, name: finalName, role: 'customer' },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.json({
            success: true,
            token,
            customer: {
                phone: customer.phone,
                name: finalName,
                points: customer.points
            }
        });
    } catch (error) {
        console.error('Error verifying OTP:', error);
        res.status(500).json({ error: 'حدث خطأ في السيرفر' });
    }
});

// Middleware to protect routes (optional for now, but useful)
const authenticateCustomer = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

    const token = authHeader.split(' ')[1];
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err || user.role !== 'customer') {
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.user = user;
        next();
    });
};

// 3. Get my profile
router.get('/me', authenticateCustomer, async (req, res) => {
    try {
        const result = await pool.query('SELECT phone, name, points FROM customers WHERE phone = $1', [req.user.phone]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        
        res.json({ success: true, customer: result.rows[0] });
    } catch (error) {
        console.error('Error fetching profile:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

module.exports = router;
