const jwt = require('jsonwebtoken');
require('dotenv').config();

function verifyToken(req, res, next) {
    const token = req.headers['authorization'];
    
    if (!token) {
        return res.status(403).json({ error: 'No token provided. Access denied.' });
    }

    const tokenPart = token.split(' ')[1]; // Expecting "Bearer TOKEN"

    if (!tokenPart) {
        return res.status(403).json({ error: 'Malformed token.' });
    }

    jwt.verify(tokenPart, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).json({ error: 'Failed to authenticate token.' });
        }
        req.user = decoded;
        next();
    });
}

module.exports = verifyToken;
