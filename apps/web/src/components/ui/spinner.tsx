import * as React from "react"
import { cn } from "cn"
import { motion } from "motion/react"

// Animate UI 写法：双弧反向旋转（外弧 0.9s 顺时针、内弧 1.5s 逆时针），
// 比单个图标 spin 更有层次；加载指示属必要动效，不受减弱动效影响。

const arcStyle: React.CSSProperties = {
  transformBox: "fill-box",
  transformOrigin: "center",
}

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      viewBox="0 0 16 16"
      fill="none"
      className={cn("size-4", className)}
      {...props}
    >
      <circle
        cx="8"
        cy="8"
        r="6.25"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeOpacity="0.15"
      />
      <motion.circle
        cx="8"
        cy="8"
        r="6.25"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="22 39"
        style={arcStyle}
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 0.9, ease: "linear" }}
      />
      <motion.circle
        cx="8"
        cy="8"
        r="6.25"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="8 39"
        strokeOpacity="0.45"
        style={arcStyle}
        animate={{ rotate: -360 }}
        transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
      />
    </svg>
  )
}

export { Spinner }
