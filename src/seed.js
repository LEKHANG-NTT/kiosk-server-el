const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('--- 🚀 Đang bắt đầu quá trình Seed dữ liệu ---');

  // 1. Tạo tài khoản Super Admin
  const superAdmin = await prisma.user.upsert({
    where: { email: 'admin@system.com' },
    update: {}, // Nếu tồn tại rồi thì không làm gì cả
    create: {
      email: 'admin@system.com',
      password: '123456', // Lưu ý: thực tế nên dùng bcrypt
      role: 'SUPERADMIN',
    },
  });
  console.log('✅ Đã tạo SuperAdmin: admin@system.com / 123456');

  // 2. Tạo một Organization mẫu (Tùy chọn - để bạn test phân quyền)
  const defaultOrg = await prisma.organization.create({
    data: {
      name: 'Tập đoàn ABC',
      brands: {
        create: [
          {
            name: 'Chi nhánh Quận 1',
            socketNamespace: 'cn-q1',
          }
        ]
      }
    }
  });
  console.log(`✅ Đã tạo Org mẫu: ${defaultOrg.name} với ID: ${defaultOrg.id}`);

  console.log('--- ✨ Seed hoàn tất thành công ---');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('❌ Lỗi Seed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });