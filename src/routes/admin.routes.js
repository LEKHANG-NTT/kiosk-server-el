const express = require('express');
const router = express.Router();
const prisma = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

// --- QUẢN LÝ ORGANIZATION ---
router.get('/orgs', authenticate, authorize(['SUPERADMIN']), async (req, res) => {
    const orgs = await prisma.organization.findMany({ include: { _count: { select: { brands: true } } } });
    res.json(orgs);
});

router.post('/orgs', authenticate, authorize(['SUPERADMIN']), async (req, res) => {
    const newOrg = await prisma.organization.create({ data: { name: req.body.name } });
    res.json(newOrg);
});

// --- QUẢN LÝ BRAND ---
router.get('/brands', authenticate, authorize(['SUPERADMIN', 'ORG_ADMIN']), async (req, res) => {
    let where = {};
    if (req.user.role === 'ORG_ADMIN') where = { orgId: req.user.orgId };
    
    const brands = await prisma.brand.findMany({ where, include: { organization: true } });
    res.json(brands);
});

// --- QUẢN LÝ USER (Tạo tài khoản cho cấp dưới) ---
router.post('/users', authenticate, authorize(['SUPERADMIN', 'ORG_ADMIN']), async (req, res) => {
    const { email, password, role, orgId, brandId } = req.body;
    const newUser = await prisma.user.create({
        data: { email, password, role, orgId, brandId }
    });
    res.json(newUser);
});
router.get('/users', authenticate, authorize(['SUPERADMIN', 'ORG_ADMIN']), async (req, res) => {
    try {
        let where = {};
        if (req.user.role === 'ORG_ADMIN') where = { orgId: req.user.orgId };

        const users = await prisma.user.findMany({
            where,
            select: { id: true, email: true, role: true, orgId: true, brandId: true } 
        });
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: "Không thể lấy danh sách người dùng" });
    }
});

module.exports = router;