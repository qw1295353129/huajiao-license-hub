import * as React from "react"
import { cn } from "cn"
import { motion, useReducedMotion, type HTMLMotionProps } from "motion/react"

// Animate UI 写法：聚焦时柔光晕开（tween 180ms，不弹跳）。
// 开启减弱动效时不接管 box-shadow，回落到 CSS 焦点环。

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  const reduceMotion = useReducedMotion()

  return (
    <motion.textarea
      data-slot="textarea"
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
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-[color,background-color,border-color,box-shadow] duration-200 ease-out outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...(props as HTMLMotionProps<"textarea">)}
    />
  )
}

export { Textarea }
