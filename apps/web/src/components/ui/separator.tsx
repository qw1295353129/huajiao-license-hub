import * as React from "react"
import { cn } from "cn"
import { Separator as SeparatorPrimitive } from "radix-ui"
import { motion, useReducedMotion, type HTMLMotionProps } from "motion/react"
import { useIsInView } from "@/hooks/use-is-in-view"

// Animate UI 写法：进入视口时从起点画出来（横向 scaleX、纵向 scaleY，once）。

function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ref,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  const reduceMotion = useReducedMotion()
  const { ref: motionRef, isInView } = useIsInView(ref, {
    inView: true,
    inViewOnce: true,
  })
  const axis = orientation === "vertical" ? "scaleY" : "scaleX"

  return (
    <SeparatorPrimitive.Root
      decorative={decorative}
      orientation={orientation}
      asChild
    >
      <motion.div
        ref={motionRef}
        data-slot="separator"
        initial={reduceMotion ? false : { [axis]: 0, opacity: 0 }}
        animate={
          isInView ? { [axis]: 1, opacity: 1 } : { [axis]: 0, opacity: 0 }
        }
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        style={
          orientation === "vertical"
            ? { transformOrigin: "top center" }
            : { transformOrigin: "left center" }
        }
        className={cn(
          "shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch",
          className
        )}
        {...(props as HTMLMotionProps<"div">)}
      />
    </SeparatorPrimitive.Root>
  )
}

export { Separator }
