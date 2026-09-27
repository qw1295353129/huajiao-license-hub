/**
 * HeroUI API → Animate UI / shadcn 兼容层。
 * 让现有页面把 `from '@/lib/heroui-compat'` 换成 `from '@/lib/heroui-compat'` 即可，
 * 底层渲染全部走 Animate UI（带动画）与 shadcn 基础件。
 */
import * as React from 'react';
import { toast as sonnerToast, Toaster as SonnerToaster } from 'sonner';
import { cn } from '@/lib/utils';

export type Key = string | number;

// ─── Button（Animate UI）──────────────────────────────────────────────
import { Button as AUIButton, type ButtonProps as AUIButtonProps } from '@/components/animate-ui/components/buttons/button';

type CompatButtonProps = Omit<AUIButtonProps, 'onClick' | 'asChild' | 'variant' | 'size'> & {
  onPress?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  isDisabled?: boolean;
  isIconOnly?: boolean;
  isPending?: boolean;
  fullWidth?: boolean;
  /** HeroUI 旧 variant 名 */
  variant?: 'primary' | 'default' | 'secondary' | 'danger' | 'danger-soft' | 'ghost' | 'outline' | 'tertiary' | 'link' | 'accent' | 'destructive';
  size?: 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm' | 'icon-lg' | 'default';
  className?: string;
};

const variantMap: Record<string, 'default' | 'secondary' | 'destructive' | 'ghost' | 'outline' | 'link' | 'accent'> = {
  primary: 'default',
  default: 'default',
  secondary: 'secondary',
  danger: 'destructive',
  'danger-soft': 'destructive',
  ghost: 'ghost',
  outline: 'outline',
  tertiary: 'ghost',
  link: 'link',
  accent: 'accent',
  destructive: 'destructive',
};

const sizeMap: Record<string, 'default' | 'sm' | 'lg' | 'icon' | 'icon-sm' | 'icon-lg'> = {
  sm: 'sm', md: 'default', lg: 'lg', default: 'default',
  icon: 'icon', 'icon-sm': 'icon-sm', 'icon-lg': 'icon-lg',
};
// sizeMap 供未来按 size 调整；当前 Button 直接透传 className
void sizeMap;

function Button({ onPress, onClick, isDisabled, isIconOnly, isPending, variant, size, fullWidth, className, disabled, ...props }: CompatButtonProps) {
  return (
    <AUIButton
      disabled={disabled || isDisabled || isPending}
      onClick={(e) => { onPress?.(e); onClick?.(e); }}
      className={cn(
        variantMap[variant ?? 'default'] === 'default' && 'bg-primary text-primary-foreground',
        variantMap[variant ?? 'default'] === 'destructive' && 'bg-destructive text-white',
        isIconOnly && 'px-0',
        fullWidth && 'w-full',
        isPending && 'opacity-60',
        className,
      )}
      {...props}
    />
  );
}

// ─── Card（shadcn）────────────────────────────────────────────────────
import {
  Card as CardRoot, CardHeader as CardHeaderBase, CardTitle as CardTitleBase,
  CardDescription as CardDescriptionBase, CardContent as CardContentBase,
  CardFooter as CardFooterBase,
} from '@/components/ui/card';

function Card(props: React.ComponentProps<typeof CardRoot>) {
  return <CardRoot {...props} />;
}
Card.Header = function CardHeader(props: React.ComponentProps<typeof CardHeaderBase>) {
  return <CardHeaderBase {...props} />;
};
Card.Title = function CardTitle(props: React.ComponentProps<typeof CardTitleBase>) {
  return <CardTitleBase {...props} />;
};
Card.Description = function CardDescription(props: React.ComponentProps<typeof CardDescriptionBase>) {
  return <CardDescriptionBase {...props} />;
};
Card.Content = function CardContent(props: React.ComponentProps<typeof CardContentBase>) {
  return <CardContentBase {...props} />;
};
Card.Footer = function CardFooter(props: React.ComponentProps<typeof CardFooterBase>) {
  return <CardFooterBase {...props} />;
};

// ─── Input / TextArea / Label / FieldError ───────────────────────────
import { Input as InputBase } from '@/components/ui/input';
import { Textarea as TextareaBase } from '@/components/ui/textarea';
import { Label as LabelBase } from '@/components/ui/label';

type InputProps = React.ComponentProps<'input'> & {
  isRequired?: boolean;
  isInvalid?: boolean;
  isDisabled?: boolean;
  isReadOnly?: boolean;
  variant?: 'primary' | 'secondary';
  fullWidth?: boolean;
};

function Input({ isRequired, isInvalid, isDisabled, isReadOnly, variant, fullWidth, className, ...props }: InputProps) {
  return (
    <InputBase
      required={isRequired}
      aria-invalid={isInvalid || undefined}
      disabled={isDisabled}
      readOnly={isReadOnly}
      className={cn(fullWidth && 'w-full', isInvalid && 'border-destructive', className)}
      {...props}
    />
  );
}

type TextAreaProps = React.ComponentProps<'textarea'> & {
  isRequired?: boolean;
  isInvalid?: boolean;
  isDisabled?: boolean;
  fullWidth?: boolean;
};

function TextArea({ isRequired, isInvalid, isDisabled, fullWidth, className, ...props }: TextAreaProps) {
  return (
    <TextareaBase
      required={isRequired}
      aria-invalid={isInvalid || undefined}
      disabled={isDisabled}
      className={cn(fullWidth && 'w-full', isInvalid && 'border-destructive', className)}
      {...props}
    />
  );
}

function Label(props: React.ComponentProps<typeof LabelBase>) {
  return <LabelBase {...props} />;
}

function FieldError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return <p className="text-xs text-destructive">{children}</p>;
}

// ─── TextField（组合：Label + Input + Error）─────────────────────────
type TextFieldProps = {
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  type?: string;
  isRequired?: boolean;
  isInvalid?: boolean;
  isDisabled?: boolean;
  isReadOnly?: boolean;
  fullWidth?: boolean;
  className?: string;
  children?: React.ReactNode;
};

function TextField({ name, value, defaultValue, onChange, type, isRequired, isInvalid, isDisabled, isReadOnly, fullWidth, className, children }: TextFieldProps) {
  // 子节点顺序：Label / Input|TextArea / Description / FieldError
  const childArray = React.Children.toArray(children);
  const inputChild = childArray.find((c) => React.isValidElement(c) && (c.type === Input || c.type === TextArea));
  const labelChild = childArray.find((c) => React.isValidElement(c) && c.type === Label);
  const errorChild = childArray.find((c) => React.isValidElement(c) && c.type === FieldError);
  const otherChildren = childArray.filter((c) => c !== inputChild && c !== labelChild && c !== errorChild);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange?.(e.target.value);

  return (
    <div className={cn('flex flex-col gap-1.5', fullWidth && 'w-full', className)}>
      {labelChild}
      {inputChild && React.isValidElement(inputChild)
        ? React.cloneElement(inputChild as React.ReactElement<InputProps & TextAreaProps>, {
            name, value, defaultValue, onChange: handleChange, type, isRequired, isInvalid, isDisabled, isReadOnly, fullWidth,
          })
        : (
          <Input
            name={name} value={value} defaultValue={defaultValue} onChange={handleChange}
            type={type} isRequired={isRequired} isInvalid={isInvalid} isDisabled={isDisabled}
            isReadOnly={isReadOnly} fullWidth={fullWidth}
          />
        )}
      {otherChildren}
      {errorChild}
    </div>
  );
}
TextField.displayName = 'TextField';

// ─── Switch（Animate UI，自带滑块）─────────────────────────────────
import { Switch as AUISwitch } from '@/components/animate-ui/components/radix/switch';

type SwitchProps = {
  isSelected?: boolean;
  defaultSelected?: boolean;
  onChange?: (value: boolean) => void;
  onCheckedChange?: (value: boolean) => void;
  isDisabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  name?: string;
  className?: string;
  children?: React.ReactNode;
};

function Switch({ isSelected, defaultSelected, onChange, onCheckedChange, isDisabled, name, className, children }: SwitchProps) {
  const handle = (v: boolean) => { onChange?.(v); onCheckedChange?.(v); };
  // children 可能是 Switch.Content 包文字，也可能是纯文字
  const text = typeof children === 'string'
    ? children
    : React.isValidElement(children) && children.type === SwitchContent
      ? (children.props as { children?: React.ReactNode }).children
      : children;
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <AUISwitch
        checked={isSelected ?? defaultSelected}
        onCheckedChange={handle}
        disabled={isDisabled}
        name={name}
      />
      {typeof text === 'string' && text ? <span className="text-sm">{text}</span> : null}
    </div>
  );
}

function SwitchContent({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}
function SwitchControl({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}
function SwitchThumb() {
  return null; // Animate UI Switch 自带滑块
}
Switch.Content = SwitchContent;
Switch.Control = SwitchControl;
Switch.Thumb = SwitchThumb;

// ─── Chip / Badge ────────────────────────────────────────────────────
import { Badge as BadgeBase } from '@/components/ui/badge';

type ChipProps = {
  color?: 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'secondary' | 'accent';
  size?: 'sm' | 'md' | 'lg';
  variant?: 'soft' | 'solid' | 'outline';
  children?: React.ReactNode;
  className?: string;
};

const chipColorMap: Record<string, string> = {
  default: 'bg-muted text-foreground',
  primary: 'bg-primary/15 text-primary',
  accent: 'bg-primary/15 text-primary',
  success: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  warning: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  danger: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  secondary: 'bg-secondary text-secondary-foreground',
};

function Chip({ color = 'default', size = 'sm', children, className }: ChipProps) {
  return (
    <BadgeBase
      variant="outline"
      className={cn(chipColorMap[color], size === 'sm' && 'text-[11px] px-2 py-0.5', className)}
    >
      {children}
    </BadgeBase>
  );
}
Chip.Label = function ChipLabel({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
};

function Badge(props: React.ComponentProps<typeof BadgeBase>) {
  return <BadgeBase {...props} />;
}

// ─── Separator ───────────────────────────────────────────────────────
import { Separator as SeparatorBase } from '@/components/ui/separator';

function Separator(props: React.ComponentProps<typeof SeparatorBase>) {
  return <SeparatorBase {...props} />;
}

// ─── Spinner ─────────────────────────────────────────────────────────
import { Spinner as SpinnerBase } from '@/components/ui/spinner';

function Spinner({ size = 'md', className, ...props }: { size?: 'sm' | 'md' | 'lg'; className?: string } & React.ComponentProps<'svg'>) {
  return <SpinnerBase className={cn(size === 'sm' && 'size-4', size === 'lg' && 'size-8', className)} {...props} />;
}

// ─── toast（sonner 兼容 HeroUI API）─────────────────────────────────
export const toast = {
  success: (msg: string, opts?: { description?: string; timeout?: number }) =>
    sonnerToast.success(msg, { description: opts?.description, duration: opts?.timeout === 0 ? Infinity : opts?.timeout }),
  danger: (msg: string, opts?: { description?: string; timeout?: number }) =>
    sonnerToast.error(msg, { description: opts?.description, duration: opts?.timeout === 0 ? Infinity : opts?.timeout }),
  error: (msg: string, opts?: { description?: string; timeout?: number }) =>
    sonnerToast.error(msg, { description: opts?.description, duration: opts?.timeout === 0 ? Infinity : opts?.timeout }),
  info: (msg: string, opts?: { description?: string; timeout?: number }) =>
    sonnerToast.info(msg, { description: opts?.description, duration: opts?.timeout === 0 ? Infinity : opts?.timeout }),
  warning: (msg: string, opts?: { description?: string; timeout?: number }) =>
    sonnerToast.warning(msg, { description: opts?.description, duration: opts?.timeout === 0 ? Infinity : opts?.timeout }),
  default: (msg: string, opts?: { description?: string; timeout?: number }) =>
    sonnerToast(msg, { description: opts?.description, duration: opts?.timeout === 0 ? Infinity : opts?.timeout }),
};

// ─── Tooltip（Animate UI）────────────────────────────────────────────
import {
  Tooltip as AUITooltipRoot, TooltipTrigger as AUITooltipTrigger,
  TooltipContent as AUITooltipContent,
} from '@/components/animate-ui/components/animate/tooltip';

function Tooltip({ children }: { children?: React.ReactNode }) {
  return <AUITooltipRoot>{children}</AUITooltipRoot>;
}
Tooltip.Trigger = function TooltipTrigger({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) {
  return <AUITooltipTrigger {...props}>{children}</AUITooltipTrigger>;
};
Tooltip.Content = function TooltipContent({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) {
  return <AUITooltipContent {...props}>{children}</AUITooltipContent>;
};

// ─── Tabs（shadcn）───────────────────────────────────────────────────
import {
  Tabs as TabsRoot, TabsList as TabsListBase, TabsTrigger as TabsTriggerBase,
  TabsContent as TabsContentBase,
} from '@/components/ui/tabs';

function Tabs({ children, ...props }: { children?: React.ReactNode; value?: string; onValueChange?: (v: string) => void; defaultValue?: string; className?: string }) {
  return <TabsRoot {...props}>{children}</TabsRoot>;
}
Tabs.List = TabsListBase;
Tabs.Trigger = TabsTriggerBase;
Tabs.Content = TabsContentBase;

// ─── Avatar ──────────────────────────────────────────────────────────
function Avatar({ children, className, ...props }: { children?: React.ReactNode; className?: string } & React.ComponentProps<'div'>) {
  return (
    <div className={cn('relative flex size-9 shrink-0 overflow-hidden rounded-full', className)} {...props}>
      {children}
    </div>
  );
}
Avatar.Fallback = function AvatarFallback({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex size-full items-center justify-center rounded-full bg-muted text-sm font-medium', className)}>
      {children}
    </div>
  );
};

// ─── EmptyState ──────────────────────────────────────────────────────
function EmptyState({ title, description, icon, action, children, className }: {
  title?: string; description?: string; icon?: React.ReactNode; action?: React.ReactNode;
  children?: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 py-10 text-center', className)}>
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      {title ? <p className="text-sm font-medium">{title}</p> : null}
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      {children}
      {action}
    </div>
  );
}

// ─── Modal（Animate UI Dialog 兼容 HeroUI 的组合 API）─────────────────
import {
  Dialog as AUIDialogRoot, DialogTrigger as AUIDialogTrigger,
  DialogContent as AUIDialogContent, DialogHeader as AUIDialogHeader,
  DialogTitle as AUIDialogTitle, DialogDescription as AUIDialogDescription,
  DialogFooter as AUIDialogFooter, DialogClose as AUIDialogClose,
} from '@/components/animate-ui/components/radix/dialog';

type ModalProps = {
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
};

function Modal({ isOpen, onOpenChange, children }: ModalProps) {
  return (
    <AUIDialogRoot open={isOpen} onOpenChange={(o) => onOpenChange?.(o)}>
      {children}
    </AUIDialogRoot>
  );
}

Modal.Trigger = function ModalTrigger({ children, className, onPress, onClick, ...props }: {
  children?: React.ReactNode; className?: string;
  onPress?: (e: React.MouseEvent) => void; onClick?: (e: React.MouseEvent) => void;
} & Record<string, unknown>) {
  return (
    <AUIDialogTrigger asChild>
      <button type="button" className={className} onClick={(e) => { onPress?.(e); onClick?.(e); }} {...props}>
        {children}
      </button>
    </AUIDialogTrigger>
  );
};

Modal.Backdrop = function ModalBackdrop({ children }: { children?: React.ReactNode; isDismissable?: boolean; variant?: string }) {
  return <>{children}</>;
};

Modal.Container = function ModalContainer({ children, size }: {
  children?: React.ReactNode; size?: string; placement?: string; scroll?: string;
}) {
  // 尺寸映射到 DialogContent 的 max-width
  const sizeClass =
    size === 'lg' ? 'sm:max-w-2xl' :
    size === 'xl' ? 'sm:max-w-4xl' :
    size === 'sm' ? 'sm:max-w-md' : 'sm:max-w-lg';
  return (
    <AUIDialogContent className={sizeClass}>
      {children}
    </AUIDialogContent>
  );
};

Modal.Dialog = function ModalDialog({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
};

Modal.Header = function ModalHeader({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <AUIDialogHeader className={className}>{children}</AUIDialogHeader>;
};

Modal.Heading = function ModalHeading({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <AUIDialogTitle className={className}>{children}</AUIDialogTitle>;
};

Modal.Description = function ModalDescription({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <AUIDialogDescription className={className}>{children}</AUIDialogDescription>;
};

Modal.Body = function ModalBody({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <div className={cn('flex flex-col gap-4 py-2', className)}>{children}</div>;
};

Modal.Footer = function ModalFooter({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <AUIDialogFooter className={className}>{children}</AUIDialogFooter>;
};

Modal.CloseTrigger = function ModalCloseTrigger() {
  return (
    <AUIDialogClose className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none">
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M11.78 4.03a.75.75 0 0 1 0 1.06L8.56 8.28l3.22 3.22a.75.75 0 1 1-1.06 1.06L7.5 9.34l-3.22 3.22a.75.75 0 0 1-1.06-1.06l3.22-3.22-3.22-3.22a.75.75 0 0 1 1.06-1.06l3.22 3.22 3.22-3.22a.75.75 0 0 1 1.06 0z" fill="currentColor"/></svg>
    </AUIDialogClose>
  );
};

// ─── Dropdown（Animate UI DropdownMenu）──────────────────────────────
import {
  DropdownMenu as AUIDropdownRoot, DropdownMenuTrigger as AUIDropdownTrigger,
  DropdownMenuContent as AUIDropdownContent, DropdownMenuItem as AUIDropdownItemBase,
  DropdownMenuSeparator as AUIDropdownSeparator,
} from '@/components/animate-ui/components/radix/dropdown-menu';

function Dropdown({ children }: { children?: React.ReactNode }) {
  return <AUIDropdownRoot>{children}</AUIDropdownRoot>;
}

Dropdown.Trigger = function DropdownTrigger({ children, className, ...props }: {
  children?: React.ReactNode; className?: string;
} & Record<string, unknown>) {
  return (
    <AUIDropdownTrigger asChild>
      <button type="button" className={className} {...props}>{children}</button>
    </AUIDropdownTrigger>
  );
};

Dropdown.Popover = function DropdownPopover({ children, placement }: { children?: React.ReactNode; placement?: string }) {
  return (
    <AUIDropdownContent align={placement === 'bottom end' ? 'end' : placement === 'bottom start' ? 'start' : 'center'}>
      {children}
    </AUIDropdownContent>
  );
};

Dropdown.Menu = function DropdownMenu({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
};

Dropdown.Section = function DropdownSection({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
};

Dropdown.Item = function DropdownItem({ children, id, onAction, isDisabled, ...props }: {
  children?: React.ReactNode; id?: string; onAction?: () => void; isDisabled?: boolean;
} & Record<string, unknown>) {
  return (
    <AUIDropdownItemBase disabled={isDisabled} onSelect={() => onAction?.()} {...props}>
      {children}
    </AUIDropdownItemBase>
  );
};

Dropdown.Separator = function DropdownSeparator() {
  return <AUIDropdownSeparator />;
};

// ─── Select（shadcn）─────────────────────────────────────────────────
import {
  Select as SelectRoot, SelectTrigger as SelectTriggerBase, SelectValue as SelectValueBase,
  SelectContent as SelectContentBase, SelectItem as SelectItemBase,
} from '@/components/ui/select';

type SelectProps = {
  name?: string;
  placeholder?: string;
  selectedKey?: string | number | null;
  onSelectionChange?: (key: string | number | null) => void;
  isDisabled?: boolean;
  isRequired?: boolean;
  isInvalid?: boolean;
  fullWidth?: boolean;
  className?: string;
  children?: React.ReactNode;
};

function Select({ name, placeholder, selectedKey, onSelectionChange, isDisabled, fullWidth, className, children }: SelectProps) {
  // children: Label + Select.Trigger(Value+Indicator) + Select.Popover(ListBox)
  // 我们用 render-prop 风格的兼容：把 ListBox.Item 转成 SelectItem
  const items: React.ReactElement[] = [];
  const labels: React.ReactElement[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === Label) labels.push(child);
    if (child.type === SelectPopover) {
      React.Children.forEach((child.props as { children?: React.ReactNode }).children, (inner) => {
        if (React.isValidElement(inner) && (inner.type as { displayName?: string }).displayName === 'ListBox') {
          React.Children.forEach((inner.props as { children?: React.ReactNode }).children, (item) => {
            if (React.isValidElement(item)) items.push(item);
          });
        }
      });
    }
  });

  return (
    <div className={cn('flex flex-col gap-1.5', fullWidth && 'w-full', className)}>
      {labels}
      <SelectRoot
        value={selectedKey != null ? String(selectedKey) : undefined}
        onValueChange={(v) => onSelectionChange?.(v)}
        disabled={isDisabled}
        name={name}
      >
        <SelectTriggerBase className={cn(fullWidth && 'w-full')}>
          <SelectValueBase placeholder={placeholder} />
        </SelectTriggerBase>
        <SelectContentBase>
          {items.map((item, i) => {
            const p = item.props as { id?: string; textValue?: string; children?: React.ReactNode };
            return (
              <SelectItemBase key={p.id ?? i} value={String(p.id ?? i)}>
                {p.textValue ?? p.children}
              </SelectItemBase>
            );
          })}
        </SelectContentBase>
      </SelectRoot>
    </div>
  );
}

function SelectTrigger({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}
function SelectValue({ placeholder }: { placeholder?: string }) {
  return <span className="text-muted-foreground">{placeholder}</span>;
}
function SelectIndicator() {
  return null;
}
function SelectPopover({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}
Select.Trigger = SelectTrigger;
Select.Value = SelectValue;
Select.Indicator = SelectIndicator;
Select.Popover = SelectPopover;

// ─── ListBox（Select 的选项容器）────────────────────────────────────
function ListBox({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}
ListBox.displayName = 'ListBox';

function ListBoxItem({ children, id, textValue }: {
  children?: React.ReactNode; id?: string; textValue?: string;
}) {
  return <span data-id={id} data-text={textValue}>{children}</span>;
}
ListBoxItem.displayName = 'ListBoxItem';
ListBox.Item = ListBoxItem;

// ─── Table（HeroUI 的 ScrollContainer/Content 集合 API）───────────────
type TableColumnProps = {
  id?: string;
  children?: React.ReactNode;
  isRowHeader?: boolean;
  className?: string;
  align?: 'left' | 'center' | 'right';
  width?: string;
};

type TableHeaderProps<T> = {
  columns?: T[];
  children?: React.ReactNode | ((column: T) => React.ReactNode);
  className?: string;
};

type TableBodyProps<T> = {
  items?: T[];
  children?: React.ReactNode | ((item: T) => React.ReactNode);
  renderEmptyState?: () => React.ReactNode;
  className?: string;
};

function Table({ children, className, ...props }: { children?: React.ReactNode; className?: string } & React.ComponentProps<'div'>) {
  return <div className={cn('w-full', className)} {...props}>{children}</div>;
}

Table.ScrollContainer = function ScrollContainer({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <div className={cn('w-full overflow-x-auto rounded-lg border border-border', className)}>{children}</div>;
};

Table.Content = function TableContent({ children, className, ...props }: { children?: React.ReactNode; className?: string } & React.ComponentProps<'table'>) {
  return <table className={cn('w-full caption-bottom text-sm', className)} {...props}>{children}</table>;
};

Table.Header = function TableHeader<T = Record<string, unknown>>({ columns, children, className }: TableHeaderProps<T>) {
  let rows: React.ReactNode;
  if (typeof children === 'function' && columns) {
    rows = columns.map((col, i) => <React.Fragment key={i}>{(children as (c: T) => React.ReactNode)(col)}</React.Fragment>);
  } else {
    rows = children as React.ReactNode;
  }
  return (
    <thead className={cn('border-b border-border bg-muted/40', className)}>
      <tr>{rows}</tr>
    </thead>
  );
};

Table.Body = function TableBody<T = Record<string, unknown>>({ items, children, renderEmptyState, className }: TableBodyProps<T>) {
  let rows: React.ReactNode;
  let hasRows: boolean;
  if (typeof children === 'function' && items) {
    hasRows = items.length > 0;
    rows = items.map((item, i) => {
      const el = (children as (it: T) => React.ReactNode)(item);
      return <React.Fragment key={(item as { id?: string }).id ?? i}>{el}</React.Fragment>;
    });
  } else {
    rows = children as React.ReactNode;
    hasRows = Boolean(children);
  }
  return (
    <tbody className={cn(className)}>
      {hasRows ? rows : (
        <tr>
          <td colSpan={99} className="p-0">{renderEmptyState?.()}</td>
        </tr>
      )}
    </tbody>
  );
};

Table.Row = function TableRow({ children, className, id, ...props }: { children?: React.ReactNode; className?: string; id?: string } & React.ComponentProps<'tr'>) {
  return <tr data-id={id} className={cn('border-b border-border transition-colors hover:bg-muted/30', className)} {...props}>{children}</tr>;
};

Table.Cell = function TableCell({ children, className, ...props }: { children?: React.ReactNode; className?: string } & React.ComponentProps<'td'>) {
  return <td className={cn('px-3 py-2.5 align-middle', className)} {...props}>{children}</td>;
};

Table.Column = function TableColumn({ id: _id, children, isRowHeader, className, align, width }: TableColumnProps) {
  void _id;
  return (
    <th
      scope={isRowHeader ? 'row' : undefined}
      className={cn('px-3 py-2 text-left text-xs font-medium text-muted-foreground', align === 'right' && 'text-right', align === 'center' && 'text-center', width, className)}
    >
      {children}
    </th>
  );
};

// ─── Toast Provider（sonner 兼容 HeroUI 的 Toast.Provider）──────────
const Toast = {
  Provider: function ToastProvider({ placement }: { placement?: string; maxVisibleToasts?: number }) {
    return (
      <SonnerToaster
        position={placement === 'bottom end' ? 'bottom-right' : 'bottom-right'}
        richColors
        closeButton
      />
    );
  },
};

// ─── 导出（保持 HeroUI 命名）────────────────────────────────────────
export {
  Button, Card, Input, TextArea, Label, FieldError, TextField,
  Switch, Chip, Badge, Separator, Spinner, Tooltip, Tabs,
  Avatar, EmptyState, Modal, Dropdown, Select, ListBox, Table, Toast,
};

export type { CompatButtonProps as ButtonProps };
