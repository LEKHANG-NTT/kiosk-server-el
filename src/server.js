const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
require('dotenv').config();

// Khởi tạo database connection
const prisma = require('./config/db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.set('io', io);

// Simple request logger to help debug 404s
app.use((req, res, next) => {
    console.log(`[HTTP] ${req.method} ${req.originalUrl} from ${req.ip}`);
    next();
});

// Nạp các Routes
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/admin', require('./routes/admin.routes'));
app.use('/api/kiosks', require('./routes/kiosk.routes'));
app.use('/api/brands', require('./routes/brand.routes')); // File tạo Brand ở tin nhắn trước
app.use('/api/debug', require('./routes/debug.routes'));

// Khởi động Socket Namespaces từ DB
const { initAllNamespaces } = require('./socket/namespace');
initAllNamespaces(io);

const PORT = process.env.PORT || 3001;
// const HOST = process.env.HOST || '0.0.0.0';

// Test database connection
prisma.$connect()
    .then(() => {
        console.log('✅ Kết nối database thành công!');
        server.listen(PORT, () => {
            console.log(`🚀 Server đang chạy tại: http://172.168.12.81:${PORT}`);
        });
    })
    .catch((err) => {
        console.error('❌ Lỗi kết nối database:', err.message);
        process.exit(1);
    });

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Đóng kết nối database...');
    await prisma.$disconnect();
    process.exit(0);
});