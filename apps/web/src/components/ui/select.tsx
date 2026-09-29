"use client"

import * as React from "react"
import { cn } from "cn"
import { Select as SelectPrimitive } from "radix-ui"
import { AnimatePresence, motion, useReducedMotion, type Transition } from "motion/react"
import { ChevronDownIcon, CheckIcon, ChevronUpIcon } from "lucide-react"
import { useControlledState } from "@/hooks/use-controlled-state"

// Animate UI 写法：弹层 spring 出场/退场 + 触发器 chevron 随开合旋转 +
// 聚焦柔光 + 勾选图标弹入。注册表暂无 select 条目，动效按同一套约定补齐。

const SelectOpenContext = React.createContext<boolean>(false)

/**
 * 已选文本来源：SelectContent 会随开合卸载（AnimatePresence），
 * Radix 的 Select.Value 靠弹层里的 ItemText 提供文本，弹层一卸载就显示为空 ——
 * 这里直接从 JSX 树里读出「value → 文本」（不依赖弹层是否挂载），
 * 于是「弹窗重开后仍带值」「选完立刻关弹层」都能正确显示。
 */
type SelectState = { value?: string; labels: Map<string, React.ReactNode> }
const SelectStateContext = React.createContext<SelectState | null>(null)

function collectSelectLabels(
  children: React.ReactNode,
  out: Map<string, React.ReactNode> = new Map(),
): Map<string, React.ReactNode> {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return
    const props = child.props as { value?: string; children?: React.ReactNode }
    if (child.type === SelectItem && props.value !== undefined && !out.has(String(props.value))) {
      out.set(String(props.value), props.children)
      return
    }
    if (props.children) collectSelectLabels(props.children, out)
  })
  return out
}

function Select({
  open,
  defaultOpen,
  onOpenChange,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  const [isOpen, setIsOpen] = useControlledState<boolean>({
    value: open,
    defaultValue: defaultOpen ?? false,
    onChange: onOpenChange,
  })
  const labels = collectSelectLabels(children)
  const state = React.useMemo<SelectState>(
    () => ({ value: props.value, labels }),
    // labels 每次渲染重建（JSX 里的选项本身就是最新的），跟着 value 一起换引用
    [props.value, labels],
  )

  return (
    <SelectStateContext.Provider value={state}>
      <SelectOpenContext.Provider value={isOpen}>
        <SelectPrimitive.Root
          data-slot="select"
          {...props}
          open={isOpen}
          onOpenChange={setIsOpen}
        >
          {children}
        </SelectPrimitive.Root>
      </SelectOpenContext.Provider>
    </SelectStateContext.Provider>
  )
}

function SelectGroup({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("scroll-my-1 p-1", className)}
      {...props}
    />
  )
}

function SelectValue({
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  const state = React.useContext(SelectStateContext)
  // 弹层卸载后 Radix 取不到已选文本，用 Select 从 JSX 里读出的「value → 文本」兜底
  const fallback =
    children ??
    (state?.value !== undefined ? state.labels.get(String(state.value)) : undefined)
  return <SelectPrimitive.Value data-slot="select-value" {...props}>{fallback}</SelectPrimitive.Value>
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default"
}) {
  const isOpen = React.useContext(SelectOpenContext)
  const reduceMotion = useReducedMotion()

  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      asChild
      {...props}
    >
      <motion.button
        type="button"
        whileFocus={
          reduceMotion
            ? undefined
            : {
                boxShadow: "0 0 0 3px color-mix(in oklab, var(--ring) 35%, transparent)",
                borderColor: "var(--ring)",
              }
        }
        transition={{ duration: 0.18, ease: "easeOut" }}
        className={cn(
          "flex w-fit items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-8 data-[size=sm]:h-7 data-[size=sm]:rounded-[min(var(--radius-md),10px)] *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
          className
        )}
      >
        {children}
        <SelectPrimitive.Icon asChild>
          <motion.span
            className="pointer-events-none flex size-4 items-center justify-center text-muted-foreground"
            animate={{ rotate: isOpen ? 180 : 0 }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : { type: "spring", stiffness: 400, damping: 30 }
            }
          >
            <ChevronDownIcon className="size-4" />
          </motion.span>
        </SelectPrimitive.Icon>
      </motion.button>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  position = "item-aligned",
  align = "center",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  const isOpen = React.useContext(SelectOpenContext)
  const reduceMotion = useReducedMotion()

  const transition: Transition = reduceMotion
    ? { duration: 0 }
    : { type: "spring", stiffness: 500, damping: 34, mass: 0.9 }

  return (
    <SelectPrimitive.Portal forceMount>
      <AnimatePresence>
        {isOpen && (
          <SelectPrimitive.Content
            asChild
            forceMount
            position={position}
            align={align}
            {...props}
          >
            <motion.div
              key="select-content"
              data-slot="select-content"
              data-align-trigger={position === "item-aligned"}
              initial={reduceMotion ? false : { opacity: 0, y: -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={transition}
              style={{ willChange: "opacity, transform" }}
              className={cn(
                "relative z-50 max-h-(--radix-select-content-available-height) min-w-36 origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10",
                className
              )}
            >
              <SelectScrollUpButton />
              <SelectPrimitive.Viewport
                data-position={position}
                className={cn(
                  "data-[position=popper]:h-(--radix-select-trigger-height) data-[position=popper]:w-full data-[position=popper]:min-w-(--radix-select-trigger-width)"
                )}
              >
                {children}
              </SelectPrimitive.Viewport>
              <SelectScrollDownButton />
            </motion.div>
          </SelectPrimitive.Content>
        )}
      </AnimatePresence>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("px-1.5 py-1 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  value,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  const reduceMotion = useReducedMotion()

  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      value={value}
      className={cn(
        "relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none transition-colors duration-150 ease-out focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <motion.span
            className="flex items-center justify-center"
            initial={reduceMotion ? false : { scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 600, damping: 30 }}
          >
            <CheckIcon className="pointer-events-none" />
          </motion.span>
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "z-10 flex cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronUpIcon />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "z-10 flex cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronDownIcon />
    </SelectPrimitive.ScrollDownButton>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
