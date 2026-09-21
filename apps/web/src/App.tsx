import { Navigate, Route, Routes } from 'react-router-dom';
import { Spinner } from '@heroui/react';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { useAuth, usePortalAuth } from '@/lib/auth';
import { LoginPage } from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { ProductsPage } from '@/pages/ProductsPage';
import { LicensesPage } from '@/pages/LicensesPage';
import { CustomersPage } from '@/pages/CustomersPage';
import { OrdersPage } from '@/pages/OrdersPage';
import { RedeemPage } from '@/pages/RedeemPage';
import { DevicesPage } from '@/pages/DevicesPage';
import { WebhooksPage } from '@/pages/WebhooksPage';
import { AuditPage } from '@/pages/AuditPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { TeamPage } from '@/pages/TeamPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { PortalLayout } from '@/portal/PortalLayout';
import { PortalLoginPage } from '@/portal/PortalLoginPage';
import { PortalLicensesPage } from '@/portal/PortalLicensesPage';
import { PortalOrdersPage } from '@/portal/PortalOrdersPage';
import { PortalRedeemPage } from '@/portal/PortalRedeemPage';
import { PortalAccountPage } from '@/portal/PortalAccountPage';
import { PortalResetPasswordPage } from '@/portal/PortalResetPasswordPage';

function Splash({ label }: { label: string }) {
  return (
    <div className="grid min-h-dvh place-items-center gap-3">
      <Spinner size="lg" />
      <p className="text-sm opacity-60">{label}</p>
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Splash label="正在校验登录状态…" />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequirePortalAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = usePortalAuth();
  if (loading) return <Splash label="正在打开用户中心…" />;
  if (!user) return <Navigate to="/portal" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      {/* 管理后台 */}
      <Route path="/admin" element={<RequireAuth><AdminLayout /></RequireAuth>}>
        <Route index element={<DashboardPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="licenses" element={<LicensesPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="redeem" element={<RedeemPage />} />
        <Route path="devices" element={<DevicesPage />} />
        <Route path="webhooks" element={<WebhooksPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="team" element={<TeamPage />} />
      </Route>

      {/* 用户门户 */}
      <Route path="/portal" element={<RequirePortalAuth><PortalLayout /></RequirePortalAuth>}>
        <Route index element={<PortalLicensesPage />} />
        <Route path="licenses" element={<PortalLicensesPage />} />
        <Route path="orders" element={<PortalOrdersPage />} />
        <Route path="redeem" element={<PortalRedeemPage />} />
        <Route path="account" element={<PortalAccountPage />} />
      </Route>
      <Route path="/portal/login" element={<PortalLoginPage />} />
      <Route path="/portal/reset-password" element={<PortalResetPasswordPage />} />

      <Route path="/" element={<Navigate to="/admin" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}