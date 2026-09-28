import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import {
  Tabs as TabsPrimitive,
  TabsList as TabsListPrimitive,
  TabsTrigger as TabsTriggerPrimitive,
  TabsContent as TabsContentPrimitive,
  TabsHighlight,
  TabsHighlightItem,
  type TabsProps as TabsPrimitiveProps,
  type TabsContentProps as TabsContentPrimitiveProps,
} from "@/components/animate-ui/primitives/radix/tabs"

// Animate UI：指示条用共享布局动画（layoutId）在触发器之间滑动，
// 内容切换走 blur + opacity 淡入淡出（primitives/radix/tabs 自带）。

type TabsProps = TabsPrimitiveProps & {
  orientation?: "horizontal" | "vertical"
}

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsProps) {
  return (
    <TabsPrimitive
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "group/tabs flex gap-2",
        orientation === "horizontal" ? "flex-col" : "flex-row",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg text-muted-foreground",
  {
    variants: {
      variant: {
        default: "h-8 bg-muted p-[3px]",
        line: "h-8 gap-1 bg-transparent p-0",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsListPrimitive> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsHighlight
      className={
        variant === "line"
          ? "absolute z-0 inset-x-0 bottom-0 h-0.5 rounded-full bg-foreground"
          : "absolute z-0 inset-0 rounded-md border border-transparent bg-background shadow-sm dark:border-input dark:bg-input/30"
      }
    >
      <TabsListPrimitive
        data-slot="tabs-list"
        data-variant={variant}
        className={cn(tabsListVariants({ variant }), className)}
        {...props}
      />
    </TabsHighlight>
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsTriggerPrimitive> & { value: string }) {
  return (
    <TabsHighlightItem value={props.value} className="flex-1">
      <TabsTriggerPrimitive
        data-slot="tabs-trigger"
        className={cn(
          "relative inline-flex h-[calc(100%-1px)] w-full flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors duration-300 ease-in-out hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 data-active:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
          className
        )}
        {...props}
      />
    </TabsHighlightItem>
  )
}

function TabsContent({
  className,
  ...props
}: TabsContentPrimitiveProps) {
  return (
    <TabsContentPrimitive
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
