const express = require('express');
const router = express.Router();
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');

router.get('/:namespace', authenticate, async (req, res) => {
    const { namespace } = req.params;

    // Phân quyền: Brand Admin chỉ xem được đúng namespace của họ
    if (req.user.role === 'BRAND_ADMIN') {
        const userBrand = await prisma.brand.findUnique({ where: { id: req.user.brandId } });
        if (userBrand.socketNamespace !== namespace) return res.status(403).json({ error: "Không có quyền" });
    }

    const kiosks = await prisma.kiosk.findMany({
        where: { brand: { socketNamespace: namespace } },
        orderBy: { lastSeen: 'desc' }
    });
    res.json(kiosks);
});

module.exports = router;