import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';

export interface PublicSiteInfo {
  siteName: string;
  allowRegistration: boolean;
}

/** 公开站点信息（站点名称等）：登录前后都能取，跨页面缓存。 */
export function useSiteInfo() {
  const query = useQuery({
    queryKey: ['site-info'],
    queryFn: async (): Promise<PublicSiteInfo> => {
      const res = await fetch('/api/site');
      if (!res.ok) return { siteName: 'LicenseHub', allowRegistration: true };
      return (await res.json()) as PublicSiteInfo;
    },
    staleTime: 5 * 60_000,
    retry: 1,
  });

  // 同步到浏览器标签页标题
  useEffect(() => {
    if (query.data?.siteName) document.title = query.data.siteName + ' · 授权管理';
  }, [query.data?.siteName]);

  return query;
}

/** 取站点名称（带默认值）。 */
export function useSiteName(): string {
  const { data } = useSiteInfo();
  return data?.siteName || 'LicenseHub';
}
