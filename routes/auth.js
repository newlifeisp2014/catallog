const express = require('express');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_key_123';

router.post('/login', (req, res) => {
    const { username, password } = req.body;

    const adminUser = process.env.ADMIN_USERNAME || 'admin';
    const adminPass = process.env.ADMIN_PASSWORD || 'admin';

    if (username === adminUser && password === adminPass) {
        const token = jwt.sign({ username }, JWT_SECRET, {
            expiresIn: '24h'
        });
        
        return res.json({ success: true, token });
    }

    return res.status(401).json({ success: false, message: 'كلمة المرور أو اسم المستخدم غير صحيح' });
});

module.exports = router;
