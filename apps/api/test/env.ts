/**
 * 测试环境变量：必须在任何业务模块被 import 之前执行。
 * 使用内存 PGlite，测试之间互不影响，也不会污染开发数据目录。
 */
import 'reflect-metadata';

process.env.NODE_ENV = 'test';
process.env.DATABASE_DRIVER = 'pglite';
process.env.PGLITE_DIR = ':memory:';
process.env.AUTO_MIGRATE = 'true';
process.env.JWT_SECRET = 'test-jwt-secret-0123456789abcdefghijklmn';
process.env.LICENSE_PEPPER = 'test-license-pepper-0123456789abcdef';
process.env.DATA_KEY = Buffer.alloc(32, 3).toString('base64');
process.env.BOOTSTRAP_ADMIN_EMAIL = 'admin@test.local';
process.env.BOOTSTRAP_ADMIN_PASSWORD = 'Admin@12345';
process.env.SWAGGER_ENABLED = 'false';
process.env.SMTP_HOST = '';

export const TEST_ADMIN = { email: 'admin@test.local', password: 'Admin@12345' };
