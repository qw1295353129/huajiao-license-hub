import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"
import { motion, useReducedMotion, type HTMLMotionProps } from "motion/react"
import { useIsInView } from "@/hooks/use-is-in-view"

// Animate UI 写法：进入视口时轻微弹入（scale 0.94 → 1，once），
// 只做缩放 + 透明度，避免长表格里成片徽章的视觉噪音。

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

type BadgeProps = React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }

function Badge({
  className,
  variant = "default",
  asChild = false,
  ref,
  ...props
}: BadgeProps) {
  const reduceMotion = useReducedMotion()
  const { ref: motionRef, isInView } = useIsInView(ref, {
    inView: true,
    inViewOnce: true,
  })

  const classes = cn(badgeVariants({ variant }), className)

  if (asChild) {
    return (
      <Slot.Root
        ref={motionRef}
        data-slot="badge"
        data-variant={variant}
        className={classes}
        {...props}
      />
    )
  }

  return (
    <motion.span
      ref={motionRef}
      data-slot="badge"
      data-variant={variant}
      initial={reduceMotion ? false : { opacity: 0, scale: 0.94 }}
      animate={isInView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.94 }}
      transition={{ type: "spring", stiffness: 320, damping: 26 }}
      className={classes}
      {...(props as HTMLMotionProps<"span">)}
    />
  )
}

export { Badge, badgeVariants }
