import 'dotenv/config'; // Bắt buộc để load biến môi trường
import { defineConfig } from '@prisma/config';

export default defineConfig({
  datasource: {
    // Đảm bảo tên biến trong .env khớp chính xác là DATABASE_URL
    url: process.env.DATABASE_URL,
  },
});