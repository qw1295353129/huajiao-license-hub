# HeroUI v3.2.6 组件用法速查表

> 面向 `license-hub/apps/web`（React 19 + Vite 8 + Tailwind v4 + TypeScript 5.9）。
> 所有片段均来自实际通过类型检查的探针文件：`apps/web/src/__probe__/HeroUiProbe.tsx`
> 验证命令：`cd apps/web && npx tsc -p tsconfig.json --noEmit`（结果：**0 error，exit 0**）

## 0. 勘察方法与权威来源

| 内容 | 来源 |
| --- | --- |
| 组件导出与 props | `node_modules/@heroui/react/dist/components/<name>/*.d.ts` |
| 复合子组件 | `dist/components/<name>/index.d.ts`（`export declare const X: Fn & { Sub: ... }`） |
| variant/size/color 取值 | `node_modules/@heroui/styles/dist/components/<name>/<name>.styles.d.ts`（`TVReturnType<{...}>` 的第一个泛型参数） |
| 默认样式（padding/gap 等） | `@heroui/styles/dist/components/<name>.css` |
| 运行时结构（谁渲染成什么元素） | `dist/components/<name>/<name>.js` |

HeroUI v3 底层是 **React Aria Components (RAC)**。凡是 `react-aria-components` 已有的组件，HeroUI 只是加样式 + 加 `data-slot`，props 直接沿用 RAC。**遇到本表没写的 prop，去查 RAC 的对应组件文档/类型即可。**

---

## 1. 五条通用规则（先看这个，能省 80% 的试错）

1. **复合组件用点号**，不是 `Xxx.Yyy` 里的 `Xxx` 单独用。例如 `Card.Header`、`Modal.Backdrop`、`Tabs.Panel`。`Xxx.Root` 是 `Xxx` 的等价别名。
2. **状态 prop 一律 `is*` 前缀**：`isDisabled` / `isRequired` / `isInvalid` / `isSelected` / `isOpen` / `isIndeterminate` / `isDismissable`。v2 的 `disabled` / `required` / `invalid` 在 v3 类型里**不存在**。
3. **`onChange` 不是 `onValueChange`**。v3 的 Checkbox/Switch/TextField/SearchField 都用 RAC 的 `onChange`（`onValueChange` 会直接 TS2322 报错，已实测）。
4. **按钮类交互用 `onPress` 而不是 `onClick`**。RAC 的 `onPress` 统一了鼠标/键盘/触摸/长按语义。
5. **子组件有 `render` prop**：大量容器组件（Card/Table/Alert/Badge/Chip/Surface/Modal 各段…）的类型是 `DOMRenderProps<E, T>`，可以 `render={(props) => <article {...props} />}` 换根元素。要求：渲染同类元素、单一根节点、把 props/ref 透传下去。

---

## 2. 组件逐条速查

### Button

~~~tsx
import { Button, toast } from "@heroui/react";

<div className="flex flex-wrap items-center gap-2">
  <Button variant="primary" size="md" onPress={() => toast("Pressed")}>Primary</Button>
  <Button variant="secondary" size="sm">Secondary</Button>
  <Button variant="tertiary" size="lg" fullWidth>Tertiary full width</Button>
  <Button variant="outline">Outline</Button>
  <Button variant="ghost">Ghost</Button>
  <Button variant="danger">Danger</Button>
  <Button variant="danger-soft">Danger soft</Button>
  <Button isDisabled>Disabled</Button>
  <Button isIconOnly aria-label="Add license" variant="secondary">
    <span aria-hidden="true">+</span>
  </Button>
</div>
~~~

- **必填**：无（`children` 可选，纯图标按钮请用 `isIconOnly` + `aria-label`）。
- `variant`：`primary | secondary | tertiary | outline | ghost | danger | danger-soft`（默认 primary）
- `size`：`sm | md | lg`（**没有 xs**）
- 其它：`fullWidth`、`isIconOnly`、`isDisabled`、`type`、`onPress`、`className`、`slot`
- **⚠️ 没有 `color` / `radius` / `shadow` / `isLoading` prop**。v3 用 `variant` 同时表达"颜色 + 形态"。由于 Button 渲染的是原生 `<button>`，写 `<Button color="primary">` **不会报类型错**（`color` 是合法 HTML 属性），但完全没效果 —— 静默失效，最坑。

### Card

~~~tsx
import { Button, Card, Separator, Skeleton, Spinner, Surface, EmptyState } from "@heroui/react";

<Surface variant="secondary" className="p-4">
  <Card variant="default">
    <Card.Header>
      <Card.Title>License overview</Card.Title>
      <Card.Description>Everything you own, in one place.</Card.Description>
    </Card.Header>
    <Card.Content>
      <p>3 licenses tracked.</p>
      <Separator orientation="horizontal" />
      <div className="flex items-center gap-2">
        <Spinner size="sm" color="accent" aria-label="Loading usage" />
        <span>Loading usage…</span>
      </div>
    </Card.Content>
    <Card.Footer>
      <Button size="sm">Manage</Button>
    </Card.Footer>
  </Card>
</Surface>
~~~

- **必填**：`Card` 的 `children`（`children: ReactNode`，非可选）。
- 子组件：`Card.Header` (div) / `Card.Title` (**h3**) / `Card.Description` (**p**) / `Card.Content` (div) / `Card.Footer` (div)
- `variant`：`default | secondary | tertiary | transparent`
- **⚠️ Card 自带 padding**。`.card` 的 CSS 是 `flex flex-col gap-3 p-4 shadow-surface` + `border-radius: min(32px, var(--radius-3xl))`。所以：
  - 不要再写 `<Card className="p-4">`（`novelcraft/src/components/common/ui.tsx` 里就是这么写的，无害但冗余）；
  - 需要内容贴边（比如整块图片头图）用 `<Card className="p-0 gap-0">`，tailwind-merge 会覆盖；
  - 不要指望 `Card.Content` 自带 padding，它只有 `flex flex-1 flex-col gap-1`。
- **⚠️ v3 的 Card 没有 `shadow` / `radius` / `isPressable` / `isHoverable` / `classNames` 这些 v2 prop**（实测全部 TS2322）。需要阴影/圆角直接用 Tailwind className。

### Chip

~~~tsx
import { Chip } from "@heroui/react";

<Chip color="success" size="sm" variant="soft"><Chip.Label>Active</Chip.Label></Chip>
<Chip color="warning" size="md" variant="primary"><Chip.Label>Expiring</Chip.Label></Chip>
<Chip color="danger" size="lg" variant="secondary"><Chip.Label>Expired</Chip.Label></Chip>
<Chip color="accent" variant="tertiary">Accent</Chip>
~~~

- **必填**：`children`。
- `color`：`accent | default | success | warning | danger`
- `size`：`sm | md | lg`
- `variant`：`primary | secondary | tertiary | soft`（**v2 的 `flat` / `solid` / `bordered` / `dot` 都没有**；实测 `variant="flat"` → TS2322）
- 直接写文本也可以（不套 `Chip.Label` 也能渲染），但需要单独控制文字样式时用 `Chip.Label`。
- 根元素是 `<span>`（`ChipRootProps<E = "span">`）。

### Input

~~~tsx
import { Input, Label, Description, FieldError, TextField } from "@heroui/react";

<TextField name="email" type="email" isRequired fullWidth>
  <Label>Email</Label>
  <Input placeholder="you@example.com" />
  <Description>We never share your address.</Description>
  <FieldError>Enter a valid email address.</FieldError>
</TextField>
~~~

- `Input` **本身只是 RAC 的 `<input>`**：`variant`（`primary | secondary`）、`fullWidth`、`className` + 所有原生 input 属性。
- **⚠️ `Input` 没有 `label` / `description` / `errorMessage` / `isRequired` prop**（实测 TS2322）。要这些必须用 `TextField` 包一层，配套 `Label` / `Description` / `FieldError`。
- 用 `<Input>` 而不用 `<input>` 的价值：拿到 HeroUI 的边框/焦点环/错误态样式。

### TextField

~~~tsx
import { TextField, Label, Input, Description, FieldError } from "@heroui/react";

<TextField
  name="email"
  type="email"
  isRequired
  isInvalid={email.length > 0 && !email.includes("@")}
  value={email}
  onChange={setEmail}
  fullWidth
>
  <Label>Email</Label>
  <Input placeholder="you@example.com" />
  <Description>We never share your address.</Description>
  <FieldError>Enter a valid email address.</FieldError>
</TextField>
~~~

- **必填**：无（`children` 典型是 `Label + (Input|TextArea) + Description + FieldError`）。
- 关键 props：`name`、`value`、`defaultValue`、`onChange(value: string)`、`type`、`isRequired`、`isInvalid`、`isDisabled`、`isReadOnly`、`validate`、`fullWidth`、`variant`（`primary | secondary`）
- `Label` 还有独立的 `isRequired` / `isDisabled` / `isInvalid` 用于渲染星号等提示。
- `FieldError` 只在字段 `isInvalid` 时可见（RAC 行为）。

### TextArea

~~~tsx
import { TextField, Label, TextArea, Description } from "@heroui/react";

<TextField name="notes" value={notes} onChange={setNotes}>
  <Label>Notes</Label>
  <TextArea rows={4} placeholder="Free-form notes" variant="secondary" />
  <Description>Markdown is supported.</Description>
</TextField>
~~~

- **⚠️ 导出名是 `TextArea`（大写 A），不是 v2 的 `Textarea`**。实测 `import { Textarea }` → `TS2724: has no exported member named 'Textarea'. Did you mean 'TextArea'?`
- `variant`：`primary | secondary`；`fullWidth`；其余为原生 textarea 属性。

### Select

~~~tsx
import { Select, Label, ListBox } from "@heroui/react";
import type { Key } from "@heroui/react";

const PLANS = ["free", "pro", "enterprise"] as const;
const [plan, setPlan] = useState<Key | null>("pro");

<Select
  name="plan"
  placeholder="Pick a plan"
  isRequired
  selectedKey={plan}
  onSelectionChange={setPlan}
  fullWidth
>
  <Label>Plan</Label>
  <Select.Trigger>
    <Select.Value />
    <Select.Indicator />
  </Select.Trigger>
  <Select.Popover>
    <ListBox>
      {PLANS.map((item) => (
        <ListBox.Item key={item} id={item} textValue={item}>
          {item}
          <ListBox.Item.Indicator />
        </ListBox.Item>
      ))}
    </ListBox>
  </Select.Popover>
</Select>
~~~

- 结构固定：`Select` → `Label` + `Select.Trigger`（内部 `Select.Value` + `Select.Indicator`〔+ `Select.ClearButton`〕）+ `Select.Popover` → `ListBox` → `ListBox.Item id`。
- **必填**：`Select.Popover` 的 `children`、`ListBox.Item` 的 `id`。
- `Select` 根 props：`selectedKey` / `defaultSelectedKey` / `onSelectionChange` / `isOpen` / `onOpenChange` / `placeholder` / `name` / `isRequired` / `isInvalid` / `isDisabled` / `fullWidth` / `variant`（`primary|secondary`）/ `onClear`。
- **⚠️ `onSelectionChange` 的签名是 `(key: Key | null) => void`** —— 清空时会给 `null`。所以受控 state 必须写成 `useState<Key | null>`，否则：
  ~~~
  TS2322: Type 'Dispatch<SetStateAction<Key>>' is not assignable to type '(key: Key | null) => void'.
  ~~~
- `Select.Value` 支持 `placeholder` prop 和函数式 children `{({ selectedText }) => ...}`（来自 RAC `SelectValue`）。

### Checkbox

~~~tsx
import { Checkbox, Description, FieldError } from "@heroui/react";

<Checkbox
  name="agree"
  isSelected={agreed}
  isRequired
  isInvalid={!agreed}
  onChange={setAgreed}
  variant="primary"
>
  <Checkbox.Content>
    <Checkbox.Control>
      <Checkbox.Indicator />
    </Checkbox.Control>
    I accept the terms
  </Checkbox.Content>
  <Description>Required to continue.</Description>
  <FieldError>You must accept the terms.</FieldError>
</Checkbox>
~~~

- 结构：`Checkbox`（= RAC `CheckboxField`，外层）→ `Checkbox.Content`（= RAC `CheckboxButton`，**可点击的标签区**）→ `Checkbox.Control`（span）→ `Checkbox.Indicator`。
- `Checkbox.Indicator` **不传 children 时会自动渲染默认勾选/半选图标**（源码里有 `checkbox-default-indicator`），所以常规场景写 `<Checkbox.Indicator />` 就行。
- **`Description` / `FieldError` 必须是 `Checkbox.Content` 的兄弟节点**，不能塞进 `Content` 里（源码注释明确要求，否则布局/label 语义会坏）。
- `onChange` 签名：`(isSelected: boolean) => void`。**v2 的 `onValueChange` 会 TS2322 报错。**
- 其它：`isIndeterminate`、`isDisabled`、`isReadOnly`、`value`、`variant`（`primary | secondary`）。

### Switch

~~~tsx
import { Switch } from "@heroui/react";

<Switch name="notify" isSelected={notify} onChange={setNotify} size="md">
  <Switch.Content>
    <Switch.Control>
      <Switch.Thumb />
    </Switch.Control>
    Email notifications
  </Switch.Content>
</Switch>
~~~

- 结构和 Checkbox 对称：`Switch`（RAC `SwitchField`）→ `Switch.Content`（RAC `SwitchButton`，可点击标签区）→ `Switch.Control` → `Switch.Thumb`。
- **⚠️ `Switch.Thumb` 必须手写**。`Switch.Control` 只渲染 `children`，不会自动生成滑块；漏了它就是一条没有圆点的轨道。可选 `Switch.Icon` 放在 Control 里做开/关图标。
- `size`：`sm | md | lg`（**没有独立 color/variant**）
- `onChange: (isSelected: boolean) => void`；同样**没有 `onValueChange`**。

### Table

~~~tsx
import { Table, EmptyState, Chip } from "@heroui/react";
import type { Key, Selection, SortDescriptor } from "@heroui/react";

type LicenseRow = { id: string; name: string; status: string; seats: number };
const LICENSE_ROWS: LicenseRow[] = [ /* ... */ ];

const [selectedKeys, setSelectedKeys] = useState<Selection>(new Set<Key>());
const [sortDescriptor, setSortDescriptor] = useState<SortDescriptor | undefined>(undefined);

<Table>
  <Table.ScrollContainer>
    <Table.Content
      aria-label="Licenses"
      selectionMode="multiple"
      selectedKeys={selectedKeys}
      onSelectionChange={setSelectedKeys}
      sortDescriptor={sortDescriptor}
      onSortChange={setSortDescriptor}
    >
      <Table.Header>
        <Table.Column id="name" isRowHeader allowsSorting>
          {({ sortDirection }) => (
            <Table.SortableColumnHeader sortDirection={sortDirection}>Name</Table.SortableColumnHeader>
          )}
        </Table.Column>
        <Table.Column id="status">Status</Table.Column>
        <Table.Column id="seats">Seats</Table.Column>
      </Table.Header>
      <Table.Body
        items={LICENSE_ROWS}
        renderEmptyState={() => <EmptyState>No licenses found</EmptyState>}
      >
        {(item: LicenseRow) => (
          <Table.Row id={item.id}>
            <Table.Cell>{item.name}</Table.Cell>
            <Table.Cell>
              <Chip color="success" size="sm">{item.status}</Chip>
            </Table.Cell>
            <Table.Cell>{item.seats}</Table.Cell>
          </Table.Row>
        )}
      </Table.Body>
    </Table.Content>
  </Table.ScrollContainer>
  <Table.Footer>{selectedKeys === "all" ? "All" : `${selectedKeys.size}`} selected</Table.Footer>
</Table>
~~~

- **⚠️ 这不是 v2 的表格。** v3 的 `Table` 根节点渲染的是一个 **`<div data-slot="table" class="table-root">`**（不是 `<table>`）；真正的 `<table>` 是 **`Table.Content`**。因此：
  - **`selectionMode` / `selectedKeys` / `onSelectionChange` / `sortDescriptor` / `onSortChange` / `aria-label` 全部挂在 `Table.Content` 上**，写到外层 `<Table>` 上要么报错要么静默无效；
  - 外层 `<Table>` 自己只接受 `variant`（`primary | secondary`）+ `className` + `render`。
- **列的声明方式**：v3 是"声明式子组件"，不是 v2 的 `columns={[...]}` 数组 prop。`<Table.Column id="...">` 写在 `<Table.Header>` 里，必须给 `id`；`isRowHeader` 标记"这一列是行标题"（可访问性必需）。需要"数据驱动列"时用 `<Table.Collection items={columns}>`。
- **行的声明方式**：`<Table.Body items={rows}>{item => <Table.Row id={item.id}>...}</Table.Row>}`（集合 API + render prop）；静态行也可以直接写 `<Table.Row>` 子元素，但同样要 `id`。
- 空状态：`<Table.Body renderEmptyState={() => <EmptyState>…</EmptyState>}>`。
- 排序：`Table.Column` 加 `allowsSorting`，children 换成函数 `({ sortDirection }) => <Table.SortableColumnHeader sortDirection={sortDirection}>…`，排序状态由 `Table.Content` 的 `sortDescriptor`/`onSortChange` 承载。
数据驱动列（**已通过类型检查**，`Table.Header` 自己支持 RAC 的 `columns` + 函数 children）：

~~~tsx
type ColumnDef = { id: string; label: string; isRowHeader?: boolean };

const LICENSE_COLUMNS: ColumnDef[] = [
  { id: "name", label: "Name", isRowHeader: true },
  { id: "status", label: "Status" },
];

<Table>
  <Table.ScrollContainer>
    <Table.Content aria-label="Licenses (data driven)">
      <Table.Header columns={LICENSE_COLUMNS}>
        {(column: ColumnDef) => (
          <Table.Column id={column.id} isRowHeader={column.isRowHeader}>
            {column.label}
          </Table.Column>
        )}
      </Table.Header>
      <Table.Body items={LICENSE_ROWS}>
        {(item: LicenseRow) => (
          <Table.Row id={item.id}>
            <Table.Cell>{item.name}</Table.Cell>
            <Table.Cell>{item.status}</Table.Cell>
          </Table.Row>
        )}
      </Table.Body>
    </Table.Content>
  </Table.ScrollContainer>
</Table>
~~~

- 其它可用子组件：`Table.ResizableContainer` + `Table.ColumnResizer`（列宽拖拽）、`Table.LoadMore` / `Table.LoadMoreContent`（无限滚动）、`Table.Footer`（div，放分页条）。

### Modal

~~~tsx
import { Button, Modal, toast, useOverlayState } from "@heroui/react";

const modalState = useOverlayState();

<Modal state={modalState}>
  <Modal.Trigger>Open modal</Modal.Trigger>
  <Modal.Backdrop isDismissable variant="opaque">
    <Modal.Container size="md" placement="center" scroll="inside">
      <Modal.Dialog>
        <Modal.Header>
          <Modal.Heading>Revoke license</Modal.Heading>
          <Modal.CloseTrigger />
        </Modal.Header>
        <Modal.Body>
          <p>This cannot be undone.</p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onPress={modalState.close}>Cancel</Button>
          <Button
            variant="danger"
            onPress={() => {
              modalState.close();
              toast.success("License revoked");
            }}
          >
            Revoke
          </Button>
        </Modal.Footer>
      </Modal.Dialog>
    </Modal.Container>
  </Modal.Backdrop>
</Modal>
~~~

- **受控 API 有两种，别记错名字：**
  1. `<Modal state={useOverlayState()}>` —— `useOverlayState()` 从 `@heroui/react` 导入，返回 `{ isOpen, open, close, toggle, setOpen }`（**v2 的 `useDisclosure` 在 v3 里没有了**）。
  2. `<Modal isOpen={open} onOpenChange={setOpen}>` —— `Modal` 根就是 RAC `DialogTrigger`，直接接受 `isOpen` / `defaultOpen` / `onOpenChange`。
- 层级（必须按这个顺序嵌套）：`Modal` → `Modal.Trigger` + `Modal.Backdrop` → `Modal.Container` → `Modal.Dialog` → `Modal.Header`(`Modal.Icon` + `Modal.Heading` + `Modal.CloseTrigger`) / `Modal.Body` / `Modal.Footer`。
- **⚠️ `Modal.Trigger` 不是 `<Button>`**：它渲染 `Pressable > div[role=button]`。所以直接写文本，**不要再套一层 `<Button>`**（会 button 套 button），要按钮样式就给它 `className`。
- **⚠️ `Modal.CloseTrigger` 必须放在 `Modal.Dialog` 内部**：它是 HeroUI `CloseButton` + `slot="close"`，靠 RAC `Dialog` 的 context 关闭，放外面点了没反应。
- `Modal.Backdrop`：`isDismissable`（默认 true = 点遮罩关闭）、`variant`：`transparent | opaque | blur`。
- `Modal.Container`：`size`：`xs | sm | md | lg | full | cover`；`placement`：`auto | top | center | bottom`；`scroll`：`inside | outside`。
- `Modal.Heading` 会自动加 `slot="title"`，RAC `Dialog` 靠它做 `aria-labelledby`。

### Drawer

~~~tsx
import { Drawer } from "@heroui/react";

<Drawer>
  <Drawer.Trigger>Open drawer</Drawer.Trigger>
  <Drawer.Backdrop variant="opaque">
    <Drawer.Content placement="right">
      <Drawer.Dialog>
        <Drawer.Header>
          <Drawer.Heading>Filters</Drawer.Heading>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <p>Filter controls go here.</p>
        </Drawer.Body>
        <Drawer.Footer>
          <Drawer.CloseTrigger>Close</Drawer.CloseTrigger>
        </Drawer.Footer>
      </Drawer.Dialog>
    </Drawer.Content>
  </Drawer.Backdrop>
</Drawer>
~~~

- 和 Modal 几乎同构，差异点：
  - `Modal.Container` → **`Drawer.Content`**，其 `placement` 是 `top | bottom | left | right`（**没有 center/auto**）；
  - 额外有 `Drawer.Handle`（移动端下拉手柄）；
  - **`Drawer.Trigger` 是真正的 RAC `Button`**（`DrawerTriggerProps extends ComponentPropsWithRef<typeof Button>`），和 `Modal.Trigger` 的 div 不一样 —— 它可以加 `isDisabled` / `onPress`。
  - 受控方式同上：`<Drawer state={useOverlayState()}>` 或 `isOpen`/`onOpenChange`。

### Tabs

~~~tsx
import { Tabs } from "@heroui/react";
import type { Key } from "@heroui/react";

const [tab, setTab] = useState<Key>("overview");

<Tabs
  selectedKey={tab}
  onSelectionChange={setTab}
  variant="primary"
  orientation="horizontal"
  align="start"
>
  <Tabs.ListContainer>
    <Tabs.List aria-label="License sections">
      <Tabs.Tab id="overview">Overview</Tabs.Tab>
      <Tabs.Tab id="usage">Usage</Tabs.Tab>
      <Tabs.Tab id="seats" isDisabled>Seats</Tabs.Tab>
      <Tabs.Indicator />
    </Tabs.List>
  </Tabs.ListContainer>
  <Tabs.Panel id="overview">Overview panel</Tabs.Panel>
  <Tabs.Panel id="usage">Usage panel</Tabs.Panel>
  <Tabs.Panel id="seats">Seats panel</Tabs.Panel>
</Tabs>
~~~

- **必填**：`Tabs` 的 `children`、`Tabs.List` 的 `children`、`Tabs.Panel` 的 `children`。
- 结构：`Tabs` → `Tabs.ListContainer`（可选，包一层才有关闭滚动条 + 左右滚动箭头 + ScrollShadow）→ `Tabs.List` → `Tabs.Tab id` …，`Tabs.Indicator` 放在 `Tabs.List` 内部（它是 RAC `SelectionIndicator`，负责滑动的选中条）；面板用 `Tabs.Panel id` 平铺在 `Tabs` 下。
- `Tabs` 根 props：`selectedKey` / `defaultSelectedKey` / `onSelectionChange`（**这里是 `(key: Key) => void`，不含 null**，与 Select 不同）、`orientation`（`horizontal|vertical`）、`variant`（`primary|secondary`）、`align`（`start|center|end`）、`disabledKeys`。
- **⚠️ v2 的 `<Tab key="x" title="X">` 形式在 v3 不存在**，改为 `<Tabs.Tab id="x">标签文本</Tabs.Tab>`，面板通过 `id` 关联。

### Dropdown

~~~tsx
import { Dropdown, toast } from "@heroui/react";

<Dropdown>
  <Dropdown.Trigger>Actions</Dropdown.Trigger>
  <Dropdown.Popover placement="bottom">
    <Dropdown.Menu
      aria-label="License actions"
      onAction={(key) => toast.info(`Action: ${String(key)}`)}
    >
      <Dropdown.Section>
        <Dropdown.Item id="edit" textValue="Edit">Edit</Dropdown.Item>
        <Dropdown.Item id="duplicate" textValue="Duplicate">Duplicate</Dropdown.Item>
      </Dropdown.Section>
      <Dropdown.Item id="delete" textValue="Delete" variant="danger">Delete</Dropdown.Item>
    </Dropdown.Menu>
  </Dropdown.Popover>
</Dropdown>
~~~

- 结构：`Dropdown`（= RAC `MenuTrigger`）→ `Dropdown.Trigger` + `Dropdown.Popover` → `Dropdown.Menu` → `Dropdown.Item id` / `Dropdown.Section`。
- **⚠️ `Dropdown.Trigger` 本身就是按钮**（`DropdownTriggerProps extends ComponentPropsWithRef<typeof Button>`）。**不要再写 `<Dropdown.Trigger><Button>…</Button></Dropdown.Trigger>`** —— 类型上不报错，运行时是 `<button>` 套 `<button>`（非法 HTML，点击/focus 行为会乱）。直接写文本或用 `className` 改样式。
- **⚠️ v2 的 `key=` 在 v3 是 `id=`**。`Dropdown.Item` / `ListBox.Item` / `Tabs.Tab` / `Table.Row` 全部用 `id`。
- `Dropdown.Menu`：`onAction(key)`、`selectionMode`、`selectedKeys`、`disabledKeys`、`shouldCloseOnSelect`、`aria-label`。
- 还有 `Dropdown.ItemIndicator`、`Dropdown.SubmenuTrigger` / `Dropdown.SubmenuIndicator`（二级菜单）。
- `Dropdown.Item` 的 `variant`：`default | danger`。

### Menu

~~~tsx
import { Menu, Popover, toast } from "@heroui/react";

<Popover>
  <Popover.Trigger>Custom trigger</Popover.Trigger>
  <Popover.Content>
    <Menu aria-label="Standalone menu" onAction={(key) => toast.info(String(key))}>
      <Menu.Item id="one" textValue="One">One</Menu.Item>
      <Menu.Section aria-label="More">
        <Menu.Item id="two" textValue="Two">
          Two
          <Menu.Item.Indicator type="checkmark" />
        </Menu.Item>
      </Menu.Section>
    </Menu>
  </Popover.Content>
</Popover>
~~~

- `Menu` 是 **RAC `Menu` 原语**，`Dropdown.Menu` 就是它加了 `data-slot`。日常请用 `Dropdown.Menu`；只有在要自造触发器时才直接写 `Menu`，而且**必须放在 `MenuTrigger` 或 `Popover` 这类 overlay 上下文里**（单独丢在页面里类型能过，运行时会取不到 state）。
- 子组件：`Menu.Item`（= `MenuItem`）、`Menu.Item.Indicator` / `Menu.ItemIndicator`（`type`：`checkmark | dot`）、`Menu.Item.SubmenuIndicator`、`Menu.Section`。
- **建议始终给 `aria-label`**（RAC `MenuProps extends AriaLabelingProps`）。
- `Menu.Item` 的 `variant`：`default | danger`（用 `Menu.Item` 即可渲染成危险色）。

### Pagination

~~~tsx
import { Pagination } from "@heroui/react";

const [page, setPage] = useState(1);

<Pagination size="md">
  <Pagination.Summary>Page {page} of 5</Pagination.Summary>
  <Pagination.Content>
    <Pagination.Item>
      <Pagination.Previous isDisabled={page === 1} onPress={() => setPage((value) => value - 1)}>
        <Pagination.PreviousIcon />
        Prev
      </Pagination.Previous>
    </Pagination.Item>
    <Pagination.Item>
      <Pagination.Link isActive={page === 1} onPress={() => setPage(1)}>1</Pagination.Link>
    </Pagination.Item>
    <Pagination.Item><Pagination.Ellipsis /></Pagination.Item>
    <Pagination.Item>
      <Pagination.Link isActive={page === 5} onPress={() => setPage(5)}>5</Pagination.Link>
    </Pagination.Item>
    <Pagination.Item>
      <Pagination.Next isDisabled={page === 5} onPress={() => setPage((value) => value + 1)}>
        Next
        <Pagination.NextIcon />
      </Pagination.Next>
    </Pagination.Item>
  </Pagination.Content>
</Pagination>
~~~

- 结构：`Pagination`(**nav**) → `Pagination.Summary`(**div**) + `Pagination.Content`(**ul**) → `Pagination.Item`(**li**) → `Pagination.Link` / `Pagination.Previous` / `Pagination.Next` / `Pagination.Ellipsis`(**span**)。
- **必填**：`Pagination`、`Summary`、`Content`、`Item`、`Link`、`Previous`、`Next` 的 `children` 都是必填（`Ellipsis` 不需要）。
- `size`：`sm | md | lg`（在根上）。
- `Link` 独有 `isActive`；`Link/Previous/Next` 都是 RAC `Button`，用 `onPress` / `isDisabled`。
- **⚠️ v3 没有 `total` / `initialPage` / `onChange` 这种"一把梭" API**，页码数组要自己算、自己 map 出 `Pagination.Item`。

### Spinner

~~~tsx
import { Spinner } from "@heroui/react";

<Spinner size="sm" color="accent" aria-label="Loading usage" />
~~~

- `size`：`sm | md | lg | xl`（**没有 xs**）；`color`：`accent | current | danger | success | warning`（**没有 primary/secondary**）。
- 实测 `color="primary"` → TS2322，`size="xs"` → TS2322。
- 根元素是 `<span>`；**请务必给 `aria-label`**（否则屏幕阅读器读不到）。

### Alert

~~~tsx
import { Alert } from "@heroui/react";

<Alert status="warning">
  <Alert.Indicator />
  <Alert.Content>
    <Alert.Title>Seat limit reached</Alert.Title>
    <Alert.Description>Buy more seats to invite teammates.</Alert.Description>
  </Alert.Content>
</Alert>

<Alert status="success">
  <Alert.Indicator><span aria-hidden="true">✓</span></Alert.Indicator>
  <Alert.Content>
    <Alert.Title>All good</Alert.Title>
    <Alert.Description>Nothing to do.</Alert.Description>
  </Alert.Content>
</Alert>
~~~

- **必填**：`Alert` 的 `children`。
- `status`：`accent | default | success | warning | danger`
- **`Alert.Indicator` 不传 children 会按 `status` 自动渲染图标**（源码里的 `alert-default-icon` 分支），所以最省事的写法就是 `<Alert.Indicator />`。
- 元素：`Alert.Content`(div) / `Alert.Title`(**p**) / `Alert.Description`(**span**)。根自带 `px-4 py-3 gap-4 shadow-surface` + 圆角。

### Toast（含 ToastProvider）

挂载（在应用根部渲染**一次**）：

~~~tsx
import { Toast } from "@heroui/react";

<Toast.Provider placement="bottom end" width={420} maxVisibleToasts={3} gap={12} />
~~~

触发（任意位置，不需要 hook / context）：

~~~tsx
import { Button, toast } from "@heroui/react";

<Button onPress={() => toast("Plain message")}>Toast</Button>
<Button onPress={() => toast.success("Saved", { description: "Your changes are live." })}>Success</Button>
<Button onPress={() => toast.danger("Failed", { timeout: 0 })}>Danger (sticky)</Button>
<Button onPress={() => toast.info("Heads up")}>Info</Button>
<Button onPress={() => toast.warning("Careful")}>Warning</Button>
<Button
  onPress={() =>
    toast.promise(Promise.resolve("done"), {
      loading: "Saving…",
      success: (data: string) => `Saved: ${data}`,
      error: (error: Error) => error.message,
    })
  }
>
  Promise
</Button>
~~~

- **`Toast.Provider` 用默认队列就行，不用传 `queue`**：模块级单例 `toastQueue` 已经和 `toast()` 绑定。**整个 App 只挂一个 `Provider`**（挂了两个会渲染两个 toast 区域）。
- **`Toast.Provider` 不写 children 时会渲染 HeroUI 的默认 toast 外观**，这是推荐用法。
- `Toast.Provider` props：`placement`（`bottom | bottom start | bottom end | top | top start | top end`，默认 `bottom`）、`width`（默认 460）、`maxVisibleToasts`（默认 3，纯视觉）、`gap`（默认 12）、`isExpanded`、`hotkey`（默认 `["altKey","KeyT"]`，传 `[]` 关闭）、`scaleFactor`（默认 0.05）、`queue`、`className`。
- `toast(message, options)`：**`message` 会被映射成 `title`**。options：
  | 字段 | 说明 |
  | --- | --- |
  | `description` | 副文本 |
  | `variant` | `default \| accent \| success \| warning \| danger` |
  | `indicator` | 自定义左侧图标 ReactNode |
  | `actionProps` | 透传给 `Toast.ActionButton` 的 `ButtonProps` |
  | `isLoading` | 显示 spinner 并保持常驻 |
  | `timeout` | 毫秒，**默认 4000，传 `0` = 不自动关闭** |
  | `onClose` | 关闭回调（在动画开始时触发，不是移除后） |
- 快捷方法：`toast.success / danger / info / warning`（info 映射到 `accent` 变体）、`toast.promise(p, {loading, success, error})`、`toast.update(id, msg, opts)`、`toast.close(key)`、`toast.clear()`、`toast.pauseAll()`、`toast.resumeAll()`、`toast.getQueue()`。`toast(...)` **返回 string key**。
- 需要自定义外观时，`Toast.Provider` 的 children 可以是渲染函数（**已验证可类型通过**）：

~~~tsx
<Toast.Provider placement="top end" isExpanded>
  {({ toast: queued }) => (
    <Toast toast={queued} variant={queued.content.variant}>
      <Toast.Indicator />
      <Toast.Content>
        <Toast.Title>Custom title</Toast.Title>
        <Toast.Description>Custom body</Toast.Description>
      </Toast.Content>
      <Toast.ActionButton>Undo</Toast.ActionButton>
      <Toast.CloseButton />
    </Toast>
  )}
</Toast.Provider>
~~~

- 也可用 `Toast.Queue` / `new ToastQueue()` 建独立队列（多区域场景），再 `<Toast.Provider queue={myQueue} />`。

### EmptyState

~~~tsx
import { EmptyState } from "@heroui/react";

<EmptyState className="mt-4">No licenses yet</EmptyState>
~~~

- 叶子组件，**没有 `EmptyState.Title` / `EmptyState.Description` / `EmptyState.Icon` 这些子组件**。根是 div，`children` 可选。
- **⚠️ 这是实测炸过的坑**：同仓库 `apps/web/src/components/common/ui.tsx` 一度写成 `<EmptyState.Title>`，tsc 直接报

  ~~~
  error TS2339: Property 'Title' does not exist on type '(<E extends keyof React.JSX.IntrinsicElements = "div">({ children, className, ...rest }: EmptyStateRootProps<E> & Omit<...>) => Element) & { ...; }'.
  error TS2339: Property 'Description' does not exist on type '...'.
  ~~~

  空状态要标题 + 描述 + 操作按钮，就自己用 div/p/Button 拼，或者套 `Card`。
- 不传 children 时渲染默认文案 `"No results found"`。
- 默认样式：`.empty-state { p-2 text-sm text-muted }` —— 居中/间距要自己用 className 补。

### Avatar

~~~tsx
import { Avatar, Badge } from "@heroui/react";

<Badge.Anchor>
  <Avatar size="md" color="accent" variant="soft">
    <Avatar.Image src="https://i.pravatar.cc/64?img=12" alt="Ada Lovelace" />
    <Avatar.Fallback>AL</Avatar.Fallback>
  </Avatar>
  <Badge color="danger" placement="top-right" size="sm" variant="primary">
    <Badge.Label>3</Badge.Label>
  </Badge>
</Badge.Anchor>
~~~

- 基于 **`@radix-ui/react-avatar`**（不是 RAC）。子组件：`Avatar.Image`（`src`/`alt`/`srcSet`…）、`Avatar.Fallback`（图片未加载/失败时显示，可放首字母）。
- `size`：`sm | md | lg`；`color`：`accent | default | success | warning | danger`；`variant`：`default | soft`。
- 单独用 `<Avatar src="..." name="..."/>`（v2 写法）**不适用**：v3 是组合式，必须显式给 `Avatar.Image` 和 `Avatar.Fallback`。

### Tooltip

~~~tsx
import { Button, Tooltip } from "@heroui/react";

<Tooltip delay={200} closeDelay={0}>
  <Tooltip.Trigger>
    <Button variant="secondary">Hover me</Button>
  </Tooltip.Trigger>
  <Tooltip.Content showArrow placement="top">
    Extra context
    <Tooltip.Arrow />
  </Tooltip.Content>
</Tooltip>
~~~

- 结构：`Tooltip`（RAC `TooltipTrigger`）→ `Tooltip.Trigger`（div 包装，把被 hover 的元素放进去）+ `Tooltip.Content`（**children 必填**）。
- `Tooltip` 根：`delay`、`closeDelay`、`isOpen`、`defaultOpen`、`onOpenChange`、`shouldSkipAnimation`。
- `Tooltip.Content`：`showArrow`（默认 `false`）、`placement`、`offset`（默认：有箭头 7，无箭头 3）、`isOpen`/`defaultOpen`。
- `Tooltip.Arrow` 放在 `Tooltip.Content` 内部，不传 children 会渲染默认三角 SVG。

### Form

~~~tsx
import { Form, TextField, Label, Input, Button } from "@heroui/react";

<Form onSubmit={(event) => event.preventDefault()}>
  <TextField name="email" type="email" isRequired fullWidth>
    <Label>Email</Label>
    <Input placeholder="you@example.com" />
  </TextField>
  <Button type="submit" variant="primary">Save</Button>
</Form>
~~~

- 就是 RAC `Form`：`onSubmit`、`action`、`validationBehavior`（`'aria' | 'native'`）、`aria-label` / `aria-labelledby`。
- `validationBehavior="native"` 才会走浏览器原生校验；默认 `'aria'`（提交时跑 RAC 校验并把错误交给 `FieldError`）。

### Typography

~~~tsx
import { Link, Typography } from "@heroui/react";

<Typography.Prose>
  <Typography.Heading level={2}>Licenses</Typography.Heading>
  <Typography.Paragraph size="sm" color="muted">
    Read the <Link href="https://example.com/docs">docs</Link>
    <Link.Icon>↗</Link.Icon> before you start.
  </Typography.Paragraph>
  <Typography.Paragraph>Install with:</Typography.Paragraph>
  <Typography.Code>pnpm add @heroui/react</Typography.Code>
  <Typography type="body-sm" weight="medium" align="start" truncate color="default">
    Truncated single-line summary that never wraps.
  </Typography>
</Typography.Prose>
~~~

- 子组件：`Typography`(根) / `Typography.Heading`(`level: 1|2|3|4|5|6`) / `Typography.Paragraph`(`size: "base"|"sm"|"xs"`) / `Typography.Code` / `Typography.Prose`(`children` 必填，是 div)。
- 根 props：`type`（`h1..h6 | body | body-sm | body-xs | code`）、`align`（`start | center | end | justify`）、`color`（`default | muted`）、`weight`（`normal | medium | semibold | bold`）、`truncate`（boolean）。
- 根基于 RAC `Text`，默认渲染 `<span>`。

### SearchField

~~~tsx
import { SearchField, Label } from "@heroui/react";

<SearchField
  value={query}
  onChange={setQuery}
  onSubmit={(value) => toast.info(`Searching ${value}`)}
  fullWidth
  variant="primary"
>
  <Label>Search</Label>
  <SearchField.Group>
    <SearchField.SearchIcon />
    <SearchField.Input placeholder="Search licenses" />
    <SearchField.ClearButton />
  </SearchField.Group>
</SearchField>
~~~

- 结构：`SearchField` → `Label` + `SearchField.Group`（RAC `Group`；也可以不写 Group 直接放 Input）→ `SearchField.SearchIcon` + `SearchField.Input` + `SearchField.ClearButton`（**只在有值时出现**）。
- props：`value` / `defaultValue` / `onChange(string)` / `onSubmit(string)` / `onClear` / `name` / `isDisabled` / `isReadOnly` / `isRequired` / `isInvalid` / `fullWidth` / `variant`（`primary | secondary`）。
- 一样可以配 `Description` / `FieldError`。

### ProgressBar

~~~tsx
import { ProgressBar } from "@heroui/react";

<ProgressBar value={62} minValue={0} maxValue={100} color="accent" size="md" aria-label="Seats used">
  <ProgressBar.Output />
  <ProgressBar.Track>
    <ProgressBar.Fill />
  </ProgressBar.Track>
</ProgressBar>
~~~

- 结构：`ProgressBar`（RAC `ProgressBar`）→ `ProgressBar.Output`（span，渲染 `valueText`/百分比文本）+ `ProgressBar.Track` → `ProgressBar.Fill`。
- 数值 props 来自 RAC：`value`、`minValue`、`maxValue`、`isIndeterminate`、`formatOptions`（Intl.NumberFormat）、`label`、`aria-label`。
- `color`：`accent | default | success | warning | danger`；`size`：`sm | md | lg`。
- **⚠️ 根不是 `DOMRenderProps`**，没有 `render` prop。
- `ProgressBar.Fill` 接受 `style`（它就是靠这个控制宽度）。

### Badge

~~~tsx
import { Avatar, Badge } from "@heroui/react";

<Badge.Anchor>
  <Avatar size="md" color="accent" variant="soft">
    <Avatar.Image src="https://i.pravatar.cc/64?img=12" alt="Ada Lovelace" />
    <Avatar.Fallback>AL</Avatar.Fallback>
  </Avatar>
  <Badge color="danger" placement="top-right" size="sm" variant="primary">
    <Badge.Label>3</Badge.Label>
  </Badge>
</Badge.Anchor>
~~~

- **必填**：`Badge.Anchor` 的 `children`。`Anchor` 是个 `<span class="badge-anchor">` 定位容器，把"被标记的元素"和 `Badge` 都放进去。
- `Badge` 的 children 是 `string | number` 时会自动包一层 `Badge.Label`；要精细控制就显式写 `<Badge.Label>`。
- `color`：`accent | default | success | warning | danger`；`placement`：`top-left | top-right | bottom-left | bottom-right`；`size`：`sm | md | lg`；`variant`：`primary | secondary | soft`。

### Separator

~~~tsx
import { Separator } from "@heroui/react";

<Separator orientation="horizontal" />
<Separator orientation="vertical" variant="tertiary" />
~~~

- `orientation`：`horizontal | vertical`；`variant`：`default | secondary | tertiary`。
- 是 RAC `Separator`，自带 `role="separator"` 和方向 ARIA。

### Link

~~~tsx
import { Link, Typography } from "@heroui/react";

<Typography.Paragraph size="sm" color="muted">
  Read the <Link href="https://example.com/docs">docs</Link>
  <Link.Icon>↗</Link.Icon> before you start.
</Typography.Paragraph>
~~~

- RAC `Link`：`href`、`target`、`rel`、`onPress`、`isDisabled`、`className`。
- `Link.Icon` 是一个 `<span>`，用来放"外链箭头"这类图标（`LinkVariants` 只暴露了 `base`/`icon` 两个 slot，没有可用的 variant 枚举）。
- **⚠️ v2 的 `color` / `underline` / `isExternal` 这类语义 prop 在 v3 类型里没有**，颜色下划线用 className 控制。

### Skeleton

~~~tsx
import { Skeleton } from "@heroui/react";

<Skeleton animationType="shimmer" className="mt-4 h-4 w-40 rounded" />
<Skeleton animationType="pulse" className="mt-2 h-4 w-24 rounded" />
<Skeleton animationType="none" className="mt-2 h-4 w-16 rounded" />
~~~

- `animationType`：`none | pulse | shimmer`，默认 `"shimmer"`。
- 根是 `<div>`，**尺寸完全靠 className**（没有 width/height/radius prop）。
- **⚠️ v2 的 `isLoaded` / `disableAnimation` 在 v3 不存在**（实测 TS2322）。要么用 `animationType="none"`，要么自己做条件渲染。

### Surface

~~~tsx
import { Card, Surface } from "@heroui/react";

<Surface variant="secondary" className="p-4">
  <Card>…</Card>
</Surface>
~~~

- **必填**：`children`。
- `variant`：`default | secondary | tertiary | transparent`。
- 它通过 `SurfaceContext` 向下传递 variant —— 嵌在里面的组件（如 `Modal.Dialog` 内部）会自动继承同一套表面层级。
- 是纯 `<div>` + `DOMRenderProps`，支持 `render`。

### Tag

~~~tsx
import { Tag, TagGroup } from "@heroui/react";

<TagGroup size="md" variant="surface">
  <TagGroup.List aria-label="Labels">
    <Tag id="billing" textValue="billing">
      billing
      <Tag.RemoveButton aria-label="Remove billing" />
    </Tag>
    <Tag id="infra" textValue="infra">
      infra
    </Tag>
  </TagGroup.List>
</TagGroup>
~~~

- **`Tag` 必须放在 `TagGroup` → `TagGroup.List` 里**（`Tag` = RAC `Tag`，需要 TagList 的 state context）。
- **必填**：`Tag` 的 `id`；列表要有 `aria-label`。
- `Tag` props：`id`、`textValue`、`isDisabled`、`onAction`、`size`(`sm|md|lg`)、`variant`(`default | surface`)。
- `Tag.RemoveButton` 是 RAC `Button`，删除行为由 `TagGroup` 的 `onRemove` 承载。
- **⚠️ 没有独立的 `TagGroup.Item`**，标签就是 `<Tag>` 直接写在 `TagGroup.List` 下。

### ListBox

~~~tsx
import { ListBox } from "@heroui/react";
import type { Selection } from "@heroui/react";

type LicenseRow = { id: string; name: string; status: string; seats: number };
const LICENSE_ROWS: LicenseRow[] = [ /* ... */ ];
const [selectedKeys, setSelectedKeys] = useState<Selection>(new Set(["LIC-1"]));

<ListBox
  aria-label="Licenses"
  selectionMode="multiple"
  selectedKeys={selectedKeys}
  onSelectionChange={setSelectedKeys}
  items={LICENSE_ROWS}
>
  {(item: LicenseRow) => (
    <ListBox.Item id={item.id} textValue={item.name}>
      {item.name}
      <ListBox.Item.Indicator />
    </ListBox.Item>
  )}
</ListBox>
~~~

- 两种写法：**数据驱动**（`items={rows}` + 函数 children，如上）或**声明式**（直接写 `<ListBox.Item id="x">…</ListBox.Item>`，见 Select 一节）。
- `aria-label` 强烈建议始终给（RAC `ListBox` 需要可访问名）。
- props：`selectionMode`（`none | single | multiple`）、`selectedKeys` / `defaultSelectedKeys` / `onSelectionChange(keys: Selection)`、`disabledKeys`、`disallowEmptySelection`、`selectionBehavior`、`renderEmptyState`、`layout`（`stack | grid`）、`orientation`。
- `Selection` 类型 = `"all" | Iterable<Key>`，受控 state 写 `useState<Selection>(new Set())`；判断时要注意 `selectedKeys === "all"` 分支，否则 `.size` 会报错。
- 子组件：`ListBox.Item` / `ListBox.Item.Indicator`（也可写 `ListBox.ItemIndicator`）/ `ListBox.Section`。
- `ListBox.Item` 的 `variant`：`default | danger`。

---

## 3. "必需 props" 速查

| 组件 | 类型上必填 | 运行时必填（类型查不出来但会 warn/报错） |
| --- | --- | --- |
| `Card` / `Surface` / `Alert` / `Chip` | `children` | — |
| `Badge.Anchor` | `children` | — |
| `Modal.Dialog` / `Pagination.*`(除 Ellipsis) / `Tabs` / `Tabs.List` / `Tabs.Panel` | `children` | — |
| `Select.Popover` | `children` | — |
| `Tooltip.Content` | `children` | — |
| `Typography.Prose` | `children` | — |
| `Pagination.Link/Previous/Next` | `children` | — |
| `Table.Content` | — | `aria-label`（RAC 表格的可访问名，缺了运行时报错） |
| `ListBox` | — | `aria-label` |
| `Menu` / `Dropdown.Menu` | — | `aria-label` |
| `TagGroup.List` | — | `aria-label` |
| `Tabs.List` | `children` | `aria-label` |
| `Button isIconOnly` | — | `aria-label` |
| `Spinner` | — | `aria-label` |
| `ListBox.Item` / `Dropdown.Item` / `Menu.Item` / `Tabs.Tab` / `Table.Row` / `Tag` | — | `id`（缺了 collection 会报 key 相关错误） |
| `Table.Column` | — | `id` |

---

## 4. v2 → v3 变更（**只列我从 v3 类型里实测反证出来的**）

下面每一条都用"写 v2 写法 → tsc 报错"验证过；报错原文保留。

| 主题 | v2 写法（在 v3 会失败） | v3 写法 | 实测错误 |
| --- | --- | --- | --- |
| 图标别名 | `import { Textarea }` | `TextArea` | `TS2724: has no exported member named 'Textarea'. Did you mean 'TextArea'?` |
| 按钮形态 | `<Button variant="solid">` | `variant="primary"` | `TS2322: Type '"solid"' is not assignable to type '"secondary" | "tertiary" | "primary" | "danger" | "danger-soft" | "ghost" | "outline" | undefined'` |
| Card 装饰 | `<Card shadow radius isPressable isHoverable>` | Tailwind className | `TS2322: Type '{ children; shadow: string; radius: string; isPressable: true; isHoverable: true; }' is not assignable to type 'IntrinsicAttributes & CardRootProps<"div"> & …'` |
| Chip 变体 | `<Chip variant="flat">` | `variant="soft"` | `TS2322: Type '"flat"' is not assignable to type '"secondary" | "tertiary" | "primary" | "soft" | undefined'` |
| Spinner | `<Spinner color="primary" size="xs">` | `color="accent"`、`size="sm"` | `Type '"primary"' is not assignable to type '"danger" | "success" | "accent" | "warning" | "current" | undefined'` / `Type '"xs"' is not assignable to type '"md" | "lg" | "sm" | "xl" | undefined'` |
| Skeleton | `<Skeleton isLoaded disableAnimation>` | `animationType="none"` | `TS2322: … not assignable to type 'IntrinsicAttributes & SkeletonRootProps<"div">…'` |
| 输入框内建标签 | `<Input label description errorMessage isRequired>` | `TextField` + `Label`/`Description`/`FieldError` | `TS2322: Type '{ label: string; description: string; errorMessage: string; isRequired: true; }' is not assignable to type 'IntrinsicAttributes & InputRootProps'` |
| 受控回调 | `onValueChange`（Switch / Checkbox） | `onChange` | `TS2322: Type '{ children; isSelected: true; onValueChange: () => void; }' is not assignable to type 'IntrinsicAttributes & SwitchRootProps'`（Checkbox 同理） |
| 展开/弹层状态 | `useDisclosure()` | `useOverlayState()` | 该导出在 v3 不存在 |
| 列表 key | `<Dropdown.Item key="x">`、`<Tab key="x">` | `id="x"` | 类型上不报错（`key` 是 React 保留 prop），**静默失效** |
| 表格列 | `<Table columns={[...]}>` + `<TableColumn>` | 列写在 `<Table.Header>` 内；数据驱动用 `<Table.Header columns={cols}>{col => <Table.Column/>}</Table.Header>` | 外层 `<Table>` 渲染的是 `<div>`，不接受 `columns` |
| 表格选中 | 挂在 `<Table>` 上 | 挂到 `<Table.Content>` | 外层 `Table` 是 div，只有 `variant`/`className` |
| 分隔线 | `Divider` | `Separator` | v3 无 `Divider` 导出 |
| Toast | `addToast()` | `toast()` + `<Toast.Provider />` | v3 无 `addToast` |
| 分页 | `total` / `initialPage` | 自己拼 `Pagination.Item` | v3 无这些 prop |

> ⚠️ **两个"沉默的坑"**：`<Button color="primary">` 和 `<Dropdown.Trigger><Button/></Dropdown.Trigger>` **都不会报类型错**。前者是因为 `color` 是合法的 HTML 属性（渲染成无意义的 attribute），后者是因为 `children` 就是 `ReactNode`（运行时变成非法嵌套 button）。**类型过关 ≠ 写对了。**

---

## 5. 最容易踩的坑（Top 名单）

1. **`Table` 根是 `<div>`，`Table.Content` 才是 `<table>`。**
   `selectionMode` / `selectedKeys` / `onSelectionChange` / `sortDescriptor` / `onSortChange` / `aria-label` 全部要写在 `Table.Content` 上；外层 `Table` 只吃 `variant` + `className` + `render`。结构必须是 `Table > Table.ScrollContainer > Table.Content > (Table.Header + Table.Body)`。

2. **`Card` 自带 `p-4` + `gap-3` + `shadow-surface` + 32px 圆角。**
   `.card { @apply relative flex flex-col gap-3 overflow-visible p-4; @apply shadow-surface; border-radius: min(32px, var(--radius-3xl)); }`
   `novelcraft/src/components/common/ui.tsx` 里的 `<Card className="p-4">` 是冗余写法（无害）。要贴边内容用 `className="p-0 gap-0"`。

3. **`Modal.Trigger` 是 `div[role=button]`，`Dropdown.Trigger` / `Drawer.Trigger` 是真 `<button>`。**
   三者**都不要在里面再套一个 `<Button>`**。而 `Modal.CloseTrigger` / `Drawer.CloseTrigger` 必须放在 `*.Dialog` **内部**（它们靠 RAC Dialog 的 `slot="close"` context 生效，放外面点了没反应）。

4. **受控状态名是 `is*` + `onChange`，而且 `Select` 的 key 可能是 `null`。**
   `isSelected/isDisabled/isRequired/isInvalid/isOpen/isDismissable`、`onChange`（不是 `onValueChange`）。`Select` 的 `onSelectionChange` 签名是 `(key: Key | null) => void`，state 写成 `useState<Key>` 会直接 `TS2322`；`useState<Key | null>` 才对。（`Tabs` 的 `onSelectionChange` 反而是 `(key: Key) => void`，不含 null。）

5. **Toast 是"全局单例 + 函数调用"，不是组件式 API。**
   App 根部挂**一次** `<Toast.Provider />`（不传 children 就有默认外观），任何地方 `import { toast }` 后直接 `toast.success("Saved", { description })` 就能弹。第一个参数是 `title`；`timeout` 默认 4000ms，**要常驻必须显式传 `timeout: 0`**。挂两个 Provider 会出现两个 toast 区域。

6. **Checkbox / Switch 的 `Description`、`FieldError` 必须是 `*.Content` 的兄弟节点**（源码注释明确要求），塞进 `Content` 里会破坏 label 语义；另外 **`Switch.Thumb` 必须手写**，`Switch.Control` 不会自动生成滑块。

7. **`useState<Selection>` 要处理 `"all"` 分支。**
   `Selection = "all" | Iterable<Key>`。`selectedKeys.size` 在 `"all"` 时会报错，要写 `selectedKeys === "all" ? "All" : String(selectedKeys.size)`。

8. **v2 的 `key=` 在 v3 全面改成 `id=`**（`Dropdown.Item` / `Menu.Item` / `ListBox.Item` / `Tabs.Tab` / `Table.Row` / `Table.Column` / `Tag`）。写 `key` 类型不报错（React 保留 prop），**但组件拿不到，菜单/表格会静默失效**。

---

## 6. 探针文件与复现

- 探针：[`apps/web/src/__probe__/HeroUiProbe.tsx`](../apps/web/src/__probe__/HeroUiProbe.tsx)（**保留在原处，供后续开发直接复制**）
- 每个组件一个导出函数（`ButtonProbe` / `TableProbe` / `OverlayProbe` …），默认导出 `HeroUiProbe` 把全部组合在一起。文件里每个 import 都真实使用（tsconfig 开了 `noUnusedLocals` / `noUnusedParameters`）。
- 复现验证：

~~~
cd /Users/l21/Documents/license-hub/apps/web
npx tsc -p tsconfig.json --noEmit
~~~

实测输出（0 error，exit code 0）：

~~~
$ npx tsc -p tsconfig.json --noEmit
===== tsc exit code: 0 =====
~~~

> 全文件无 `any`、无 `@ts-ignore` / `@ts-expect-error`、无类型断言（探针初版唯一的一个错误就是 `Select.onSelectionChange` 的 `Key | null`，靠改 state 类型修掉，没有用断言绕过）。

---

## 7. 常用类型导入

~~~tsx
import type { Key, Selection, SortDescriptor } from "@heroui/react";
~~~

`@heroui/react` 的根 barrel 会 re-export `react-aria-components` 里这些类型（见 `dist/components/rac/index.d.ts`）：

`Key`、`Direction`、`Orientation`、`PressEvent`、`PointerType`、`KeyboardEvent`、`HoverEvent`、`Selection`、`TimeValue`、`DateValue`、`DateRange`、`ValidationResult`、`RangeValue`、`RouterConfig`、`Color`、`ColorFormat`、`ColorSpace`、`ColorChannel`、`ColorChannelRange`、`ColorAxes`、`SortDescriptor`。

另外根 barrel 还从 `tailwind-variants` re-export：`tv`、`cn`、`VariantProps`。需要拼 HeroUI 的类名时可以直接用 `cn`。

---

## 8. 尚未在探针里验证的部分（后续开发注意）

以下内容从 `.d.ts` 读出来是确定的，但**探针里没有实际写 JSX 跑类型检查**，第一次用请留意：

- `Calendar` / `DatePicker` / `DateRangePicker` / `TimeField` / `NumberField` / `ComboBox` / `Autocomplete` / `Slider` / `Meter` / `Radio` / `RadioGroup` / `CheckboxGroup` / `SwitchGroup` / `InputOTP` / `Accordion` / `Breadcrumbs` / `Disclosure` / `Kbd` / `AvatarGroup` / `ButtonGroup` / `ToggleButton` / `ToggleButtonGroup` / `Toolbar` / `ScrollShadow` / `CloseButton` / `Header` / `Fieldset` / `ProgressCircle` / `AlertDialog` / `ColorPicker` 系列 —— 本表未覆盖（不在任务清单内）。
- `Table.ResizableContainer` + `Table.ColumnResizer`、`Table.LoadMore` / `Table.LoadMoreContent`（无限滚动）。
- `Dropdown.SubmenuTrigger` / `Dropdown.SubmenuIndicator`、`Dropdown.ItemIndicator`。
- `Virtualizer` / `TableLayout` / `ListLayout`（从 `@heroui/react` re-export，做虚拟滚动）。
- `Toast.Provider` 的 `hotkey`、`scaleFactor` 行为；`ToastQueue` 独立队列。
