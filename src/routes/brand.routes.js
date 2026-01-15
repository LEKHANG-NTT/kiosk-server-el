const express = require('express');
const router = express.Router();
const prisma = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { createNamespace } = require('../socket/namespace');

// GET /api/brands - list brands (with kiosks and organization). Access varies by role.
router.get('/', authenticate, async (req, res) => {
    try {
        if (req.user.role === 'SUPERADMIN') {
            const brands = await prisma.brand.findMany({ include: { kiosks: true, organization: true }, orderBy: { createdAt: 'desc' } });
            return res.json(brands);
        }

        if (req.user.role === 'ORG_ADMIN') {
            const brands = await prisma.brand.findMany({ where: { orgId: req.user.orgId }, include: { kiosks: true, organization: true }, orderBy: { createdAt: 'desc' } });
            return res.json(brands);
        }

        // BRAND_ADMIN
        if (req.user.role === 'BRAND_ADMIN') {
            const brand = await prisma.brand.findUnique({ where: { id: req.user.brandId }, include: { kiosks: true, organization: true } });
            return res.json(brand ? [brand] : []);
        }

        res.status(403).json({ error: 'Không có quyền' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/', authenticate, authorize(['SUPERADMIN', 'ORG_ADMIN']), async (req, res) => {
    try {
        const { name, orgId, socketNamespace } = req.body;

        // Nếu là ORG_ADMIN, chỉ được tạo Brand cho Org của chính mình
        const targetOrgId = req.user.role === 'ORG_ADMIN' ? req.user.orgId : orgId;

        const newBrand = await prisma.brand.create({
            data: {
                name,
                orgId: targetOrgId,
                socketNamespace: socketNamespace.replace('/', '') // Đảm bảo format sạch
            }
        });

        // KÍCH HOẠT NGAY SOCKET NAMESPACE MỚI
        const io = req.app.get('io');
        createNamespace(io, newBrand.socketNamespace);

        res.json(newBrand);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;