const prisma = require('../config/db');
const jwt = require('jsonwebtoken');

/**
 * Hàm khởi tạo logic cho một Namespace cụ thể
 * - Thêm xác thực JWT cho socket handshake
 * - Quản lý room `kiosk:<kioskId>` để gửi command mục tiêu
 * - Trả về ack cho dashboard khi target offline
 */
const setupNamespaceLogic = (io, nsName) => {
    const nsp = io.of(`/${nsName}`);

    // Map kioskId -> socketId (được giữ trên mỗi namespace)
    nsp.kioskMap = nsp.kioskMap || new Map();

    // Middleware xác thực token (JWT) cho mọi kết nối namespace này
    nsp.use((socket, next) => {
        const token = socket.handshake.auth?.token || socket.handshake.query?.token;
        if (!token) {
            console.warn(`[namespace:${nsName}] socket ${socket.id} missing auth token`);
            return next(new Error('Authentication error: token missing'));
        }
        try {
            const payload = jwt.verify(token, process.env.JWT_SECRET);
            socket.user = payload;
            console.log(`[namespace:${nsName}] socket ${socket.id} authenticated (user=${payload.id || payload.sub || payload.role || 'unknown'})`);
            return next();
        } catch (err) {
            console.warn(`[namespace:${nsName}] socket ${socket.id} JWT verify failed: ${err.message}`);
            return next(new Error('Authentication error'));
        }
    });

    nsp.on('connection', async (socket) => {
        const { kioskId, type } = socket.handshake.query || {};

        // Lấy thông tin Brand từ DB dựa trên namespace
        const brand = await prisma.brand.findUnique({ where: { socketNamespace: nsName } });
        if (!brand) {
            console.error(`❌ Không tìm thấy Brand cho namespace: /${nsName}`);
            return socket.disconnect(true);
        }

        // ----- KIOSK -----
        if (type === 'kiosk' && kioskId) {
            console.log(`🤖 Kiosk [${kioskId}] kết nối vào /${nsName} (socketId=${socket.id})`);

            // Nếu client đã gửi metadata trong handshake.auth, xử lý đăng ký ngay
            const handshakeMeta = socket.handshake.auth?.kioskMeta || socket.handshake.query?.kioskMeta;
            if (handshakeMeta) {
                try {
                    const meta = typeof handshakeMeta === 'string' ? JSON.parse(handshakeMeta) : handshakeMeta;
                    // register/update kiosk record with provided metadata
                    await registerOrUpdateKiosk(kioskId, brand, meta, nsp);
                } catch (err) {
                    console.warn('Invalid kioskMeta on handshake', err.message);
                }
            }

            // Join room riêng cho kiosk để dashboard có thể target trực tiếp
            const roomName = `kiosk:${kioskId}`;
            socket.join(roomName);
            nsp.kioskMap.set(kioskId, socket.id);

            // Upsert trạng thái kiosk
            await prisma.kiosk.upsert({
                where: { id: kioskId },
                update: { status: 'online', lastSeen: new Date() },
                create: { id: kioskId, brandId: brand.id, status: 'online', specs: {} }
            });

            // Thông báo UI cập nhật
            nsp.emit('refresh-ui');
            // Phát sự kiện trạng thái riêng cho kiosk này
            nsp.emit('kiosk-status', { kioskId, status: 'online' });

            // Cập nhật cấu hình từ Kiosk
            socket.on('kiosk-report-config', async (data) => {
                await prisma.kiosk.update({ where: { id: kioskId }, data: { specs: data, lastSeen: new Date() } });
                nsp.emit('refresh-ui');
            });

            // Kiosk có thể gửi event đăng ký/chỉnh sửa thông tin chi tiết
            // payload: { brandId?, orgId?, specs?, appVersion?, location?, metadata? }
            socket.on('register-kiosk', async (meta, cb) => {
                try {
                    await registerOrUpdateKiosk(kioskId, brand, meta, nsp);
                    if (typeof cb === 'function') cb({ ok: true });
                } catch (err) {
                    console.error('register-kiosk error', err);
                    if (typeof cb === 'function') cb({ ok: false, error: err.message });
                }
            });

            // Nhận ảnh chụp màn hình
            socket.on('kiosk-screenshot-report', async (data) => {
                await prisma.kiosk.update({ where: { id: kioskId }, data: { lastScreenshot: data.image, lastSeen: new Date() } });
                nsp.emit('kiosk-screenshot-report-ui', { kioskId, image: data.image });
            });

            // Kiosk phản hồi ack cho command nếu muốn
            socket.on('mcp-command-response', (payload) => {
                // payload: { commandId, result }
                nsp.emit('mcp-command-response-ui', { kioskId, ...payload });
            });

            socket.on('disconnect', async () => {
                console.log(`Lost connection: Kiosk [${kioskId}] socketId=${socket.id}`);
                nsp.kioskMap.delete(kioskId);
                await prisma.kiosk.update({ where: { id: kioskId }, data: { status: 'offline' } });
                nsp.emit('refresh-ui');
                nsp.emit('kiosk-status', { kioskId, status: 'offline' });
            });
        }

        // ----- DASHBOARD / ADMIN -----
        if (type === 'dashboard') {
            console.log(`💻 Dashboard connected to /${nsName} (user=${socket.user?.id})`);

            // Phân quyền: nếu là BRAND_ADMIN, chỉ cho phép namespace của brand mình
            if (socket.user.role === 'BRAND_ADMIN' && socket.user.brandId !== brand.id) {
                console.warn('Brand admin attempted to join a different namespace');
                return socket.disconnect(true);
            }

            // Khi dashboard gửi command, chỉ forward tới room của kiosk cụ thể
            // Dữ liệu: { target, commandId, cmd, payload }
            socket.on('send-mcp-command', async (data, ack) => {
                try {
                    const { target, commandId, cmd, payload } = data;
                    const roomName = `kiosk:${target}`;

                    // Nếu kiosk online (room có socket)
                    const sockets = await nsp.in(roomName).allSockets();
                    if (sockets && sockets.size > 0) {
                        // Gửi tới room (tất cả socket của kiosk, thường 1)
                        nsp.to(roomName).emit('mcp-command', { commandId, cmd, payload });
                        console.log(`📡 Forwarded command [${cmd}] -> kiosk:${target} (room)`);
                        if (ack) ack({ ok: true, forwarded: true });
                    } else {
                        // Debug: show current kioskMap keys and sizes
                        console.warn(`⚠️ No sockets in room ${roomName}. kioskMap keys: ${Array.from(nsp.kioskMap.keys()).join(', ')}`);

                        // Fallback: broadcast to entire namespace so a kiosk that didn't join room can still receive
                        try {
                            nsp.emit('mcp-command', { commandId, cmd, payload, target });
                            console.log(`📡 Broadcasted command [${cmd}] in /${nsName} as fallback -> target:${target}`);
                            if (ack) ack({ ok: true, forwarded: false, broadcasted: true });
                        } catch (e) {
                            console.error('Fallback broadcast failed', e);
                            if (ack) ack({ ok: false, forwarded: false, reason: 'target-offline' });
                        }
                    }
                } catch (err) {
                    console.error('Error forwarding mcp command', err);
                    if (ack) ack({ ok: false, forwarded: false, reason: err.message });
                }
            });
        }
    });
};

/**
 * Helper: đăng ký hoặc cập nhật kiosk với metadata từ client
 */
async function registerOrUpdateKiosk(kioskId, brand, meta = {}, nsp) {
    const data = {
        status: 'online',
        lastSeen: new Date(),
    };

    if (meta.specs) data.specs = meta.specs;
    if (meta.appVersion) data.appVersion = meta.appVersion;
    if (meta.location) data.location = meta.location;
    if (meta.metadata) data.metadata = meta.metadata;

    // Brand and org association: prefer DB brand, but accept orgId if provided
    const updateOrCreate = {
        where: { id: kioskId },
        update: data,
        create: Object.assign({ id: kioskId, brandId: brand.id, status: 'online' }, data)
    };

    // If client provided orgId, include it in create/update where possible
    if (meta.orgId) {
        updateOrCreate.update.orgId = meta.orgId;
        updateOrCreate.create.orgId = meta.orgId;
    }

    await prisma.kiosk.upsert(updateOrCreate);

    // Emit events so dashboard cập nhật ngay
    nsp.emit('refresh-ui');
    nsp.emit('kiosk-status', { kioskId, status: 'online' });
    nsp.emit('kiosk-registered', { kioskId, brandId: brand.id, orgId: meta.orgId || null });
}

/**
 * Hàm nạp toàn bộ Brand từ DB để mở các cổng Socket tương ứng
 */
const initAllNamespaces = async (io) => {
    try {
        const brands = await prisma.brand.findMany();
        brands.forEach(brand => {
            setupNamespaceLogic(io, brand.socketNamespace);
            console.log(`✔️  Namespace Active: /${brand.socketNamespace}`);
        });
    } catch (err) {
        console.error("❌ Lỗi khi khởi tạo Namespaces:", err);
    }
};

module.exports = {
    initAllNamespaces,
    createNamespace: setupNamespaceLogic // Dùng khi tạo Brand mới từ API
};