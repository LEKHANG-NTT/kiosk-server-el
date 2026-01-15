const express = require('express');
const router = express.Router();
const prisma = require('../config/db');
const jwt = require('jsonwebtoken');

router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await prisma.user.findUnique({ 
            where: { email },
            include: { organization: true, brand: true } 
        });

        // Kiểm tra pass (Lưu ý: Thực tế nên dùng bcrypt để compare)
        if (!user || user.password !== password) {
            return res.status(401).json({ error: "Sai email hoặc mật khẩu" });
        }

        // Tạo Token chứa thông tin phân quyền
        const token = jwt.sign(
            { id: user.id, role: user.role, orgId: user.orgId, brandId: user.brandId },
            process.env.JWT_SECRET,
            { expiresIn: '1d' }
        );

        res.json({
            token,
            user: {
                email: user.email,
                role: user.role,
                orgName: user.organization?.name,
                brandName: user.brand?.name,
                brandNamespace: user.brand?.socketNamespace
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;