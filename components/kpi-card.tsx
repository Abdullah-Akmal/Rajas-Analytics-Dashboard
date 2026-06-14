"use client"

import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { TrendingUp, TrendingDown, Minus } from "lucide-react"

interface KpiCardProps {
  title: string
  value: string
  subValue?: string
  trend?: number
  trendLabel?: string
  icon?: React.ReactNode
  className?: string
  accent?: "default" | "success" | "warning" | "danger"
}

export function KpiCard({ title, value, subValue, trend, trendLabel, icon, className, accent = "default" }: KpiCardProps) {
  const TrendIcon = trend === undefined || trend === 0 ? Minus : trend > 0 ? TrendingUp : TrendingDown
  const trendColor = trend === undefined || trend === 0
    ? "text-muted-foreground"
    : trend > 0
    ? "text-[oklch(0.7_0.15_150)]"
    : "text-destructive"

  const borderColor = {
    default: "border-border",
    success: "border-[oklch(0.7_0.15_150)]",
    warning: "border-[oklch(0.75_0.18_75)]",
    danger: "border-destructive",
  }[accent]

  return (
    <Card className={cn("border-l-2", borderColor, className)}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground truncate">{title}</p>
            <p className="text-2xl font-bold text-foreground mt-1 leading-tight">{value}</p>
            {subValue && <p className="text-xs text-muted-foreground mt-0.5">{subValue}</p>}
            {trend !== undefined && (
              <div className={cn("flex items-center gap-1 mt-2 text-xs", trendColor)}>
                <TrendIcon className="size-3" />
                <span>{Math.abs(trend).toFixed(1)}% {trendLabel || "vs prev period"}</span>
              </div>
            )}
          </div>
          {icon && (
            <div className="size-9 rounded-lg bg-secondary flex items-center justify-center shrink-0 ml-3">
              <span className="text-primary">{icon}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
