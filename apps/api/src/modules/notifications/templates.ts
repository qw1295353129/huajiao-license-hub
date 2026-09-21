/** 邮件模板：纯字符串渲染，避免引入模板引擎。变量用 {{name}} 占位。 */

export interface TemplateDefinition {
  subject: string;
  /** 纯文本正文（同时作为 HTML 的降级内容） */
  body: string;
  /** 可选 HTML 包装（默认用 body 生成简单 HTML） */
  html?: string;
}

export const EMAIL_TEMPLATES = {
  welcome: {
    subject: '欢迎使用 {{siteName}}',
    body: '你好 {{name}}：\n\n你的账号已创建成功，登录邮箱：{{email}}。\n\n登录后可查看你的授权、绑定设备与订单。',
  },
  license_issued: {
    subject: '你的 {{product}} 授权已发放',
    body: '你好 {{name}}：\n\n产品：{{product}}\n套餐：{{plan}}\n授权码：{{licenseKey}}\n有效期至：{{expiresAt}}\n\n请在软件的激活窗口填入授权码。',
  },
  order_paid: {
    subject: '订单 {{orderNo}} 支付成功',
    body: '你好 {{name}}：\n\n订单号：{{orderNo}}\n金额：{{total}}\n已为你自动发码，共 {{licenseCount}} 个授权。\n\n授权码：\n{{licenseKeys}}',
  },
  license_expiring: {
    subject: '你的 {{product}} 授权将在 {{daysLeft}} 天后到期',
    body: '你好 {{name}}：\n\n授权码 {{licenseKey}} 将于 {{expiresAt}} 到期（剩余 {{daysLeft}} 天）。\n续费后有效期自动顺延。',
  },
  license_expired: {
    subject: '你的 {{product}} 授权已到期',
    body: '你好 {{name}}：\n\n授权码 {{licenseKey}} 已于 {{expiresAt}} 到期，软件将进入受限模式。\n如需继续使用请续费。',
  },
  password_reset: {
    subject: '重置你的 {{siteName}} 密码',
    body: '你好 {{name}}：\n\n请在 {{expiresIn}} 内点击下面的链接重置密码：\n{{resetUrl}}\n\n如果不是你本人操作，请忽略本邮件。',
  },
  device_unbound: {
    subject: '设备已解绑',
    body: '你好 {{name}}：\n\n授权 {{licenseKey}} 下的设备「{{deviceName}}」已解绑，当前可用设备 {{activeDevices}}/{{maxDevices}}。',
  },
  domain_authorized: {
    subject: '域名 {{domain}} 已开通授权',
    body: '你好 {{name}}：\n\n域名 {{domain}} 已成功绑定授权，有效期至 {{expiresAt}}。\n现在可以在网站后台点击「域名激活」完成接入。',
  },
  redeem_success: {
    subject: '卡密兑换成功',
    body: '你好 {{name}}：\n\n卡密 {{code}} 兑换成功。\n产品：{{product}}\n套餐：{{plan}}\n授权码：{{licenseKey}}\n有效期至：{{expiresAt}}',
  },
} as const satisfies Record<string, TemplateDefinition>;

export type EmailTemplate = keyof typeof EMAIL_TEMPLATES;

export function renderTemplate(template: EmailTemplate, vars: Record<string, string | number | null | undefined>): { subject: string; text: string; html: string } {
  const definition = EMAIL_TEMPLATES[template];
  const replace = (input: string): string =>
    input.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
      const value = vars[key];
      return value === null || value === undefined ? '—' : String(value);
    });

  const subject = replace(definition.subject);
  const text = replace(definition.body);
  const html = '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.7;color:#111">'
    + text.split('\n').map((line) => (line.trim() === '' ? '<br/>' : '<p style="margin:0 0 6px">' + line + '</p>')).join('')
    + '</div>';
  return { subject, text, html };
}