import * as React from "react"
import { cn } from "cn"
import { motion, useReducedMotion, type HTMLMotionProps } from "motion/react"

// Animate UI 写法：聚焦时柔光晕开（tween 180ms，不弹跳）。
// 开启减弱动效时不接管 box-shadow，回落到 CSS 焦点环。

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  const reduceMotion = useReducedMotion()

  return (
    <motion.input
      type={type}
      data-slot="input"
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
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-[color,background-color,border-color,box-shadow] duration-200 ease-out outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...(props as HTMLMotionProps<"input">)}
    />
  )
}

export { Input }
