import type { LicenseStatus, LicenseType } from '@license-hub/shared';

export const LICENSE_TYPE_LABEL: Record<LicenseType, string> = {
  trial: '试用',
  subscription: '订阅',
  perpetual: '永久',
  duration: '时长卡',
  consumable: '次数卡',
};

export const LICENSE_STATUS_LABEL: Record<LicenseStatus, string> = {
  issued: '已发放',
  active: '已激活',
  expired: '已过期',
  suspended: '已暂停',
  revoked: '已吊销',
  banned: '已封禁',
};

export const SOURCE_LABEL: Record<string, string> = {
  manual: '手工创建',
  batch: '批量生成',
  import: 'CSV 导入',
  order: '订单发码',
  redeem: '卡密兑换',
  trial: '试用',
  api: '接口创建',
  reissue: '换发',
};

export const EVENT_LABEL: Record<string, string> = {
  created: '创建',
  activated: '激活',
  deactivated: '解绑',
  verified: '心跳',
  updated: '修改',
  revoked: '吊销',
  resumed: '恢复',
  suspended: '暂停',
  banned: '封禁',
  extended: '延期',
  reissued: '换发',
  expired: '到期',
  devices_reset: '清空设备',
  activation_pending: '待审批',
  activation_approved: '审批通过',
  offline_issued: '离线签发',
  trial_started: '试用开始',
};
