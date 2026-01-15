const jwt = require('jsonwebtoken');

// 1. Xác thực Token
const authenticate = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Truy cập bị từ chối!' });

    try {
        const verified = jwt.verify(token, process.env.JWT_SECRET);
        req.user = verified;
        next();
    } catch (err) {
        res.status(400).json({ error: 'Token không hợp lệ!' });
    }
};

// 2. Kiểm tra quyền (Role-based Access Control)
const authorize = (roles = []) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Bạn không có quyền thực hiện hành động này!' });
        }
        next();
    };
};

module.exports = { authenticate, authorize };