const express = require('express');
const router = express.Router();

// GET /api/debug/sockets
// Return list of namespaces and connected sockets with kioskId from handshake
router.get('/sockets', async (req, res) => {
    try {
        const io = req.app.get('io');
        const nsps = [];

        // io._nsps is a Map in socket.io v4
        for (const [name, nsp] of io._nsps) {
            try {
                const sockets = await nsp.fetchSockets();
                const list = sockets.map(s => ({ socketId: s.id, kioskId: s.handshake.query?.kioskId || null, user: s.user || null, rooms: Array.from(s.rooms || []) }));
                nsps.push({ namespace: name, sockets: list });
            } catch (e) {
                nsps.push({ namespace: name, error: e.message });
            }
        }

        res.json({ ok: true, namespaces: nsps });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

module.exports = router;
