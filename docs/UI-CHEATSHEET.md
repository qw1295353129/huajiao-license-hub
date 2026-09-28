# 前端 UI 组件速查（heroui-compat + Animate UI）

> 面向 `apps/web`（React 19 + Vite 8 + Tailwind v4 + TypeScript 5.9）。
> 项目已从 HeroUI v3 迁出：现在是 **shadcn/ui 基础件 + Animate UI 动效组件 + Motion**，
> 页面统一从 `@/lib/heroui-compat` 导入组件（保留 HeroUI 风格 API，页面代码无需关心底层）。
> 本文取代旧的 `HEROUI-V3-CHEATSHEET.md`（该表引用的 `@heroui/react` 已不存在于依赖中）。

---

## 1. 分层与文件位置

| 层 | 位置 | 说明 |
| --- | --- | --- |
| 兼容层（页面只 import 这里） | `src/lib/heroui-compat.tsx` | HeroUI 风格 API（`is*` 前缀、点号复合组件），底层分发到下面两层 |
| shadcn/ui 基础件 | `src/components/ui/*` | radix-ui 基座 + Tailwind；部分已加 Motion 动效（见 §3） |
| Animate UI 动效组件 | `src/components/animate-ui/{primitives,components}/*` | 以源码 copy-in 方式引入（`npx shadcn@latest add @animate-ui/...`），可自由修改 |
| 动效 hooks | `src/hooks/{use-is-in-view,use-controlled-state,use-data-state,use-auto-height}.tsx` | Animate UI 依赖的通用 hook |

`components.json` 已注册 `@animate-ui` registry，装新组件：

~~~bash
cd apps/web
npx shadcn@latest add @animate-ui/primitives-radix-tabs        # 安装
npx shadcn@latest add @animate-ui/<名字> --dry-run             # 先看装什么
npx shadcn@latest add @animate-ui/<名字> --diff <file>         # 对比更新差异
~~~

命名规则 `@animate-ui/<组>-<分类>-<名称>`：`components-*` 开箱即用，`primitives-*` 可组合原语，
`demo-*` 官方演示；`base-*` / `radix-*` / `headless-*` 是同一控件的基座变体——**本项目 base = radix**（`components.json` 的 `style: radix-nova`），只装 `radix-*`。

---

## 2. 通用规则（HeroUI 风格 API 保留的部分）

1. **复合组件用点号**：`Card.Header`、`Modal.Body`、`Dropdown.Item`、`Select.Popover`、`ListBox.Item`、`Table.Column`、`Tabs.Trigger` 等。
2. **状态 prop 用 `is*` 前缀**：`isDisabled` / `isRequired` / `isInvalid` / `isSelected` / `isPending` / `isIconOnly` / `fullWidth`。
3. **回调按组件分两类**：
   - 原生元素类（`Input` / `TextArea`）：`onChange` 是原生事件（`e.target.value`）；
   - 组合类（`TextField` / `Switch`）：`onChange` 直接回传值（`onChange={(v: string) => …}`）；
   - `Select` 用 `onSelectionChange(key)`。
4. **按钮 `onPress` 与 `onClick` 都收**（内部都会触发）；`variant` 接受 HeroUI 旧名（`primary` / `danger` / `danger-soft` / `tertiary` …，内部映射到新 variant）。
5. **`Modal.CloseTrigger` 必须放在 `Modal.Container` 内部**（它靠 Dialog context 关闭并绝对定位在右上角）。

---

## 3. 组件 → 底层实现 → 动效

| 组件 | 底层 | 动效 |
| --- | --- | --- |
| `Button` | Animate UI `components/buttons/button` | hover / press 反馈 |
| `Card` | `ui/card` | 入场浮起（y 8px + 淡入，进入视口 once） |
| `Input` / `TextArea` | `ui/input` / `ui/textarea` | 聚焦柔光晕开（180ms tween） |
| `TextField` | 组合（Label + Input/TextArea + FieldError） | 见上面两个 |
| `Label` | `ui/label` | 无（文字标签，动了只添噪） |
| `FieldError` | 本地 | 出现时上浮（spring 500/32） |
| `Switch` | Animate UI `components/radix/switch` | 滑块 spring |
| `Tooltip` | Animate UI `components/animate/tooltip` | 淡入位移 |
| `Modal` | Animate UI `components/radix/dialog` | 遮罩淡入 + 内容缩放位移 |
| `Dropdown` | Animate UI `components/radix/dropdown-menu` | 弹层 spring + 高亮扫过（Highlight） |
| `Select` + `ListBox` | `ui/select` | 弹层 spring 出场/退场、chevron 随开合旋转、勾选图标弹入 |
| `Tabs` | `ui/tabs`（基于 `@animate-ui/primitives/radix/tabs`） | 指示条 `layoutId` 滑动 + 内容 blur 切换；`variant="line"` 为下划线滑条 |
| `Chip` / `Badge` | `ui/badge` | 进入视口轻弹入（scale 0.94 → 1，once） |
| `Separator` | `ui/separator` | 进入视口画线展开（scaleX，once） |
| `Spinner` | `ui/spinner` | 双弧反向旋转（0.9s / 1.5s） |
| `Avatar` | 本地 | 无 |
| `EmptyState` | 本地 + Animate UI `primitives/effects/fade` | 淡入 |
| `Table` | 语义化 HTML 表格封装 | 行 hover 变色（CSS） |
| `Toast` / `toast` | sonner | 弹出动效（库自带） |

---

## 4. 动效约定（新增动效请照此办理）

**分两类，策略不同：**

- **入场 / 聚焦类**（Card、Separator、Badge、EmptyState、FieldError、输入聚焦柔光）：
  用 `motion` + `useIsInView`（视口入场、`once`），并尊重系统「减弱动效」——
  `useReducedMotion()` 为真时不设置 `initial`，直接呈现终态。
- **弹层 / 状态切换类**（Select 弹层、Modal、Dropdown、Tabs 切换、Switch、Spinner）：
  保持常动，**不**被减弱动效拦截（Animate UI 原生行为；加载指示与弹层属于必要反馈）。

**常用参数**（与现有组件保持一致，别随手换）：

| 场景 | 参数 |
| --- | --- |
| 卡片入场 | `spring { stiffness: 220, damping: 28 }` |
| 徽章弹入 | `spring { stiffness: 320, damping: 26 }` |
| 报错上浮 | `spring { stiffness: 500, damping: 32 }` |
| 聚焦柔光 | `tween 0.18s easeOut` |
| 分隔线展开 | `tween 0.45s [0.16, 1, 0.3, 1]` |
| Select 弹层 | `spring { stiffness: 500, damping: 34, mass: 0.9 }` |
| Tabs 指示条 | `spring { stiffness: 200, damping: 25 }`（registry 默认） |

原则：动效要传达状态（出现、切换、聚焦），不做纯装饰；幅度克制（位移 ≤ 8~12px、缩放 ≥ 0.94），
避免长列表里成片同时播放（所以 Badge/Card 用「进入视口 once」而不是每次渲染都播）。

---

## 5. 常用写法

### TextField（Label + 输入 + 错误）

~~~tsx
import { TextField, Label, Input, FieldError } from '@/lib/heroui-compat';

<TextField value={email} onChange={setEmail} isRequired isInvalid={!!err} fullWidth>
  <Label>邮箱</Label>
  <Input type="email" placeholder="you@example.com" />
  <FieldError>{err}</FieldError>
</TextField>
~~~

### Modal（isOpen 受控）

~~~tsx
import { Modal, Button, TextField, TextArea, Label } from '@/lib/heroui-compat';

<Modal isOpen={open} onOpenChange={setOpen}>
  <Modal.Trigger onPress={() => setOpen(true)}>新建</Modal.Trigger>
  <Modal.Container size="lg">
    <Modal.CloseTrigger />
    <Modal.Header><Modal.Heading>标题</Modal.Heading></Modal.Header>
    <Modal.Body>
      <TextField …><Label>名称</Label><Input /></TextField>
    </Modal.Body>
    <Modal.Footer><Button onPress={save}>保存</Button></Modal.Footer>
  </Modal.Container>
</Modal>
~~~

### Select + ListBox

~~~tsx
import { Select, Label, ListBox, type Key } from '@/lib/heroui-compat';

<Select
  selectedKey={productId}
  onSelectionChange={(k: Key | null) => setProductId(k as string)}
  fullWidth
>
  <Label>产品</Label>
  <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
  <Select.Popover>
    <ListBox>
      {products.map((p) => (
        <ListBox.Item key={p.id} id={p.id} textValue={p.name}>{p.name}</ListBox.Item>
      ))}
    </ListBox>
  </Select.Popover>
</Select>
~~~

### Tabs

~~~tsx
import { Tabs } from '@/lib/heroui-compat';

<Tabs defaultValue="a" onValueChange={setTab}>
  <Tabs.List>
    <Tabs.Trigger value="a">甲</Tabs.Trigger>
    <Tabs.Trigger value="b">乙</Tabs.Trigger>
  </Tabs.List>
  <Tabs.Content value="a">内容 A</Tabs.Content>
  <Tabs.Content value="b">内容 B</Tabs.Content>
</Tabs>
~~~

### Dropdown

~~~tsx
import { Dropdown, Button } from '@/lib/heroui-compat';

<Dropdown>
  <Dropdown.Trigger><Button>操作</Button></Dropdown.Trigger>
  <Dropdown.Popover placement="bottom end">
    <Dropdown.Menu>
      <Dropdown.Item id="edit" onAction={edit}>编辑</Dropdown.Item>
      <Dropdown.Separator />
      <Dropdown.Item id="del" onAction={del}>删除</Dropdown.Item>
    </Dropdown.Menu>
  </Dropdown.Popover>
</Dropdown>
~~~

### Table（columns / items 渲染属性）

~~~tsx
import { Table, Chip, EmptyState, Spinner } from '@/lib/heroui-compat';

<Table.ScrollContainer>
  <Table.Content>
    <Table.Header columns={[{ id: 'name', children: '名称' }, { id: 'status', children: '状态' }]}>
      {(col) => <Table.Column key={col.id} isRowHeader={col.id === 'name'}>{col.children}</Table.Column>}
    </Table.Header>
    <Table.Body items={rows} renderEmptyState={() => <EmptyState title="暂无数据" />}>
      {(row) => (
        <Table.Row id={row.id}>
          <Table.Cell>{row.name}</Table.Cell>
          <Table.Cell><Chip color={row.ok ? 'success' : 'warning'}>{row.statusText}</Chip></Table.Cell>
        </Table.Row>
      )}
    </Table.Body>
  </Table.Content>
</Table.ScrollContainer>
~~~

### toast

~~~tsx
import { toast, Toast } from '@/lib/heroui-compat';

toast.success('已保存');
toast.danger('失败了', { description: err.message });
// <Toast.Provider placement="bottom end" /> 已在 main.tsx 挂好
~~~

---

## 6. 新增 / 修改组件的坑（都踩过）

1. **注册表源码与项目 tsconfig 不完全兼容**：装完先跑 `pnpm --filter @license-hub/web typecheck`。
   典型问题：类型要 `import { type X }`（`verbatimModuleSyntax`）、未使用的 `import * as React` 会被 `noUnusedLocals` 拦下。
2. **`useIsInView` 必须挂 hook 返回的 ref**，不要挂自己新建的 ref——它内部的 IntersectionObserver 观察的是自己那份 ref，
   挂错会导致元素**永远卡在入场初态（透明）**。
3. **导入别名**：第三方注册表文件写死 `@/components/...`，本项目正好用 `@/`，无需改；换别名体系要手改。
4. **变体要与 base 一致**：本项目 base=radix，只用 `radix-*` 条目；混用 base/headless 会出问题。
5. **不要用未安装的组件**：先看 `src/components/animate-ui/` 下有什么，或 `npx shadcn@latest info --json`。
6. **动效改动验证**：`pnpm --filter @license-hub/web build`（含 tsc）+ 浏览器过一遍关键页面；
   入场动效受「减弱动效」影响，测试时留意系统设置。
7. **发版后看不到新动效**：先硬刷新（旧 `index.html` 缓存）；`apps/web/nginx.conf` 已给 `index.html` 设 `no-store`，
   重新构建 web 镜像后不再复发。
