# 前端 UI 组件速查（shadcn/ui + Animate UI）

> 面向 `apps/web`（React 19 + Vite 8 + Tailwind v4 + TypeScript 5.9）。
> HeroUI 及其兼容层已彻底移除（`e6d7515`），页面直接从 `@/components/...` 导入组件。
> 底层 = **shadcn/ui 基础件 + Animate UI 动效组件（copy-in 源码）+ Motion**。

---

## 1. 分层与导入路径

| 用途 | 导入 | 说明 |
| --- | --- | --- |
| 按钮 | `@/components/animate-ui/components/buttons/button` | Animate UI；`variant` / `size` 见 §2 |
| 弹窗 | `@/components/animate-ui/components/radix/dialog` | `Dialog` `DialogTrigger` `DialogContent` `DialogHeader` `DialogTitle` `DialogDescription` `DialogFooter` `DialogClose` |
| 下拉菜单 | `@/components/animate-ui/components/radix/dropdown-menu` | `DropdownMenu` `DropdownMenuTrigger` `DropdownMenuContent` `DropdownMenuItem` `DropdownMenuSeparator` … |
| 开关 | `@/components/animate-ui/components/radix/switch` | 滑块 spring |
| Tooltip | `@/components/animate-ui/components/animate/tooltip` | `Tooltip` `TooltipTrigger` `TooltipContent` |
| Tabs | `@/components/ui/tabs` | 基于 `@animate-ui/primitives/radix/tabs`：指示条滑动 + 内容 blur 切换 |
| 表单 | `@/components/ui/{input,textarea,select,label,checkbox}` | `Input` / `Textarea` 带聚焦柔光 |
| 卡片 / 徽章 / 分隔线 / 加载 | `@/components/ui/{card,badge,separator,spinner}` | 各带动效，见 §3 |
| 表格 | `@/components/common/DataTable` | `DataTable` / `Pagination` / `Column<T>` |
| 页面公共件 | `@/components/common/ui` | `PageHeader` `StatCard` `Loading` `EmptyHint` `StatusChip` `Tag` `Field` `ErrorNotice` |
| 危险操作确认 | `@/components/common/ConfirmModal` | 可选填原因（写审计） |
| toast | `sonner` | `toast.success/error/info/warning`；`<Toaster />` 已在 `main.tsx` |

shadcn 基础件在 `src/components/ui/`、Animate UI 在 `src/components/animate-ui/{primitives,components}/`、
动效 hooks 在 `src/hooks/`（`use-is-in-view` / `use-controlled-state` / `use-data-state` / `use-auto-height`）。

---

## 2. API 现在是标准 shadcn / radix 风格

不再有 HeroUI 的 `is*` / `onPress` / 点号复合组件，全部是常规 React props：

- **Button**：`variant` = `default | secondary | destructive | ghost | outline | link | accent`；
  `size` = `default | sm | lg | icon | icon-sm | icon-lg`；`onClick` / `disabled` / `className`
- **表单**：原生 props（`value` / `onChange` 事件 / `disabled` / `aria-invalid` / `name` …）
- **Select**：radix Root 语义（`value` / `defaultValue` / `onValueChange` / `name` / `disabled`），
  子结构 `SelectTrigger` + `SelectValue` + `SelectContent` + `SelectItem`
- **Dialog**：受控 `open` / `onOpenChange`；`DialogContent` 自带右上角关闭按钮（不必手写 ×）
- **Tabs**：`Tabs`（`value` / `defaultValue` / `onValueChange`）+ `TabsList`（`variant="default" | "line"`）
  + `TabsTrigger value=` + `TabsContent value=`

---

## 3. 动效约定（新增动效请照此办理）

**分两类，策略不同：**

- **入场 / 聚焦类**（Card、Separator、Badge、EmptyHint、输入聚焦柔光）：
  `motion` + `useIsInView`（视口入场、`once`），并尊重系统「减弱动效」——`useReducedMotion()` 为真时
  不设 `initial`，直接呈现终态。
- **弹层 / 状态切换类**（Select 弹层、Dialog、DropdownMenu、Tabs 切换、Switch、Spinner）：
  保持常动，**不**被减弱动效拦截（弹层与加载指示属必要反馈）。

**常用参数**（与现有组件保持一致，别随手换）：

| 场景 | 参数 |
| --- | --- |
| 卡片入场 | `spring { stiffness: 220, damping: 28 }` |
| 徽章弹入 | `spring { stiffness: 320, damping: 26 }` |
| 聚焦柔光 | `tween 0.18s easeOut`（`box-shadow: 0 0 0 3px color-mix(in oklab, var(--ring) 35%, transparent)`） |
| 分隔线展开 | `tween 0.45s [0.16, 1, 0.3, 1]` |
| Select 弹层 | `spring { stiffness: 500, damping: 34, mass: 0.9 }` |
| Tabs 指示条 | `spring { stiffness: 200, damping: 25 }`（registry 默认） |

原则：动效传达状态（出现、切换、聚焦），不做纯装饰；幅度克制（位移 ≤ 8~12px、缩放 ≥ 0.94）；
长列表用「进入视口 once」而不是每次渲染都播。

---

## 4. 常用写法（取自真实页面，可直接抄）

### Select 筛选（`pages/DevicesPage.tsx`）

~~~tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

<Select name="status" value={status != null ? String(status) : ''}
  onValueChange={(v) => { setStatus(v); setPage(1); }}>
  <SelectTrigger className="w-full"><SelectValue placeholder="全部状态" /></SelectTrigger>
  <SelectContent>
    {['pending', 'active', 'deactivated', 'blocked'].map((value) => (
      <SelectItem key={value} value={value}>{value}</SelectItem>
    ))}
  </SelectContent>
</Select>
~~~

### Dialog 表单（`pages/ApiKeysPage.tsx` 结构）

~~~tsx
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger }
  from '@/components/animate-ui/components/radix/dialog';
import { Button } from '@/components/animate-ui/components/buttons/button';

<Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setCreated(null); }}>
  <DialogTrigger asChild>
    <button type="button" className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:opacity-90">
      新建密钥
    </button>
  </DialogTrigger>
  <DialogContent className="sm:max-w-lg">
    <DialogHeader><DialogTitle>新建接口密钥</DialogTitle></DialogHeader>
    <div className="flex flex-col gap-4 py-2">{/* 表单体 */}</div>
    <DialogFooter>
      <Button variant="ghost" onClick={() => setOpen(false)}>取消</Button>
      <Button onClick={submit}>创建</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
~~~

### DropdownMenu（`components/layout/AdminLayout.tsx`）

~~~tsx
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem }
  from '@/components/animate-ui/components/radix/dropdown-menu';

<DropdownMenu>
  {/* ⚠️ DropdownMenuTrigger 自身就是 <button>：asChild 包普通元素，别再套 <Button> */}
  <DropdownMenuTrigger asChild>
    <button type="button" className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-black/5">
      {user?.name ?? '未登录'}
    </button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end">
    <DropdownMenuItem onSelect={() => navigate('/admin/settings')}>设置</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
~~~

### DataTable + Pagination（`pages/DevicesPage.tsx`）

~~~tsx
import { DataTable, Pagination, type Column } from '@/components/common/DataTable';
import { StatusChip, Tag } from '@/components/common/ui';

const columns: Column<DeviceRow>[] = [
  { id: 'id', label: '设备', isRowHeader: true, render: (row) => <Tag>{row.fingerprint.slice(0, 8)}</Tag> },
  { id: 'status', label: '状态', render: (row) => <StatusChip status={row.status} /> },
];

<DataTable
  ariaLabel="设备绑定记录"
  columns={columns}
  items={data?.items ?? []}
  isLoading={isLoading}
  emptyTitle="还没有设备激活记录"
  emptyDescription="客户端调用 /api/v1/activate 后会出现在这里。"
  footer={<Pagination page={page} pageSize={pageSize} total={data?.total ?? 0}
    onChange={(nextPage, nextSize) => { setPage(nextPage); setPageSize(nextSize); }} />}
/>
~~~

### 危险操作二次确认（`components/common/ConfirmModal.tsx`）

~~~tsx
import { ConfirmModal } from '@/components/common/ConfirmModal';

<ConfirmModal
  trigger="作废"
  title="作废这张卡密？"
  description="作废后不可恢复"
  withReason
  onConfirm={async (reason) => { await voidCard(id, reason); toast.success('已作废'); }}
/>
~~~

---

## 5. 坑（都踩过）

1. **注册表源码与项目 tsconfig 不完全兼容**：装完先跑 `pnpm --filter @license-hub/web typecheck`。
   典型：类型要 `import { type X }`（`verbatimModuleSyntax`）、未使用的 `import * as React` 被 `noUnusedLocals` 拦。
2. **`useIsInView` 必须挂 hook 返回的 ref**，不要挂自己新建的 ref——它内部的 IntersectionObserver 观察的是自己那份 ref，
   挂错会让元素**永远卡在入场初态（透明）**。
3. **Select 已选文本来自 JSX 收集**：`Select` 会遍历子树把 `SelectItem` 的 `value → children` 存成映射，
   `SelectValue` 在弹层卸载后用它兜底显示（弹层随 `AnimatePresence` 卸载，Radix 原生 `Select.Value` 取不到文本）。
   由此两条约束：**选项必须写成 `SelectItem` 且 `value` 为字符串**；`SelectValue` 一般不传 `children`。
4. **`DropdownMenuTrigger` / `DialogTrigger` 自身是 `<button>`**：`asChild` 时包普通元素或样式类，
   再套 `<Button>` 会形成 button 嵌套（浏览器告警 + 行为异常）。
5. **变体与 base 一致**：本项目 base = radix（`components.json` 的 `style: radix-nova`），
   装 Animate UI 只用 `radix-*` 条目，别混 `base-*` / `headless-*`。
6. **动效验证**：`pnpm --filter @license-hub/web build`（含 tsc）+ 浏览器过一遍关键页面；
   入场动效受系统「减弱动效」影响，测试时留意该设置。
7. **发版后看不到新界面**：先硬刷新（旧 `index.html` 缓存）。`apps/web/nginx.conf` 已给 `index.html`
   设 `no-store`，重建 web 镜像后不再复发。

---

## 6. 装新组件（shadcn CLI + `@animate-ui` registry）

`components.json` 已注册 `@animate-ui` registry：

~~~bash
cd apps/web
npx shadcn@latest add @animate-ui/primitives-radix-tabs        # 安装
npx shadcn@latest add @animate-ui/<名字> --dry-run             # 先看装什么
npx shadcn@latest add @animate-ui/<名字> --diff <file>         # 对比更新差异
npx shadcn@latest search @animate-ui -q "tabs"                 # 搜索
~~~

命名规则 `@animate-ui/<组>-<分类>-<名称>`：`components-*` 开箱即用、`primitives-*` 可组合原语、`demo-*` 官方演示；
`base-*` / `radix-*` / `headless-*` 是同一控件的基座变体（本项目只用 `radix-*`）。
安装落点自动映射到 `src/components/animate-ui/<组>/<分类>/<名称>.tsx`。

> 注：注册表**没有** select / input / spinner / badge / card 等条目，这些是按同一套约定手写的
> （`src/components/ui/*` 里的 Motion 实现），改动时参照 §3 的动效约定。
