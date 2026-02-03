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

// API: Cho phép thay đổi URL của một Kiosk và chuyển lệnh 'set-url' xuống thiết bị
router.post('/:kioskId/set-url', authenticate, async (req, res) => {
    const { kioskId } = req.params;
    const { url } = req.body || {};

    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'Missing url' });

    // Basic URL validation
    try {
        new URL(url);
    } catch (e) {
        return res.status(400).json({ error: 'Invalid URL' });
    }

    // Tìm kiosk và kiểm tra phân quyền
    const kiosk = await prisma.kiosk.findUnique({ where: { id: kioskId } });
    if (!kiosk) return res.status(404).json({ error: 'Kiosk not found' });

    const brand = await prisma.brand.findUnique({ where: { id: kiosk.brandId } });
    if (!brand) return res.status(404).json({ error: 'Brand not found' });

    // Brand admin chỉ có quyền với kiosk cùng brand
    if (req.user.role === 'BRAND_ADMIN' && req.user.brandId !== brand.id) return res.status(403).json({ error: 'No permission' });

    // Cập nhật DB (merge specs)
    const currentSpecs = kiosk.specs || {};
    const newSpecs = Object.assign({}, currentSpecs, { url });
    await prisma.kiosk.update({ where: { id: kioskId }, data: { specs: newSpecs } });

    // Gửi lệnh set-url xuống kiosk qua namespace
    const io = req.app.get('io');
    try {
        const nsp = io.of(`/${brand.socketNamespace}`);
        const roomName = `kiosk:${kioskId}`;
        const commandId = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
        nsp.to(roomName).emit('mcp-command', { commandId, cmd: 'set-url', payload: { url }, target: kioskId });
        return res.json({ ok: true });
    } catch (err) {
        console.error('Failed to forward set-url command', err);
        return res.status(500).json({ ok: false, error: err.message });
    }
});

module.exports = router;