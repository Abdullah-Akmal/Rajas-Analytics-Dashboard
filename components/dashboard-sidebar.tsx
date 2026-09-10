"use client"

import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  TrendingUp,
  BarChart3,
  PieChart,
  ShoppingCart,
  Truck,
  Clock,
  Tag,
  Users,
  ShoppingBag,
  Bell,
  Zap,
  RefreshCw,
  MapPin,
  GitMerge,
  LineChart,
  Gauge,
  Lightbulb,
  ClipboardCheck,
  Settings2,
} from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
} from "@/components/ui/sidebar"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const analyticsItems = [
  { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { label: "Item Profitability", href: "/dashboard/costing", icon: TrendingUp },
  { label: "Item Performance", href: "/dashboard/sales", icon: BarChart3 },
  { label: "Category Performance", href: "/dashboard/costing", icon: PieChart, secondary: true },
  { label: "Channel Performance", href: "/dashboard/platforms", icon: ShoppingCart },
  { label: "Offers & Promotions", href: "/dashboard/offers", icon: Tag },
  { label: "Offer Performance", href: "/dashboard/offer-performance", icon: Gauge, secondary: true },
]

const operationsItems = [
  { label: "Hourly Demand", href: "/dashboard/demand", icon: Clock },
  { label: "Delivery & Drivers", href: "/dashboard/delivery", icon: Truck },
  { label: "Basket Growth", href: "/dashboard/basket", icon: ShoppingBag },
  { label: "Direct Customers", href: "/dashboard/customers", icon: Users },
]

const intelligenceItems = [
  { label: "Offer Recommendation", href: "/dashboard/recommendations", icon: Lightbulb },
  { label: "Decision Support", href: "/dashboard/decisions", icon: ClipboardCheck },
  { label: "Forecasting", href: "/dashboard/forecast", icon: LineChart },
  { label: "Alert System", href: "/dashboard/alerts", icon: Bell, badge: "Live", badgeVariant: "destructive" as const },
  { label: "Action Panel", href: "/dashboard/actions", icon: Zap, badge: "Weekly", badgeVariant: "default" as const },
]

function NavItem({ item, pathname }: { item: { label: string; href: string; icon: React.ElementType; badge?: string; badgeVariant?: "default" | "destructive" | "outline"; secondary?: boolean }; pathname: string }) {
  const isActive = pathname === item.href
  if (item.secondary) return null // category performance is a tab on costing page
  return (
    <SidebarMenuItem>
      <SidebarMenuButton isActive={isActive} render={<Link href={item.href} />}>
        <item.icon className="size-4" />
        <span>{item.label}</span>
        {item.badge && (
          <Badge
            variant={item.badgeVariant ?? "outline"}
            className={cn(
              "ml-auto text-xs px-1.5 py-0",
              item.badgeVariant === "outline" && "border-amber-500 text-amber-600"
            )}
          >
            {item.badge}
          </Badge>
        )}
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

export function DashboardSidebar() {
  const pathname = usePathname()

  return (
    <Sidebar>
      <SidebarHeader className="px-4 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-lg overflow-hidden bg-background flex items-center justify-center shrink-0">
            <Image src="/logo.png" alt="Rajas logo" width={40} height={40} className="object-contain w-auto h-auto max-w-[40px] max-h-[40px]" />
          </div>
          <div>
            <p className="font-semibold text-sm text-foreground leading-tight">Rajas Analytics</p>
            <p className="text-xs text-muted-foreground">Restaurant Intelligence</p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Analytics</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {analyticsItems.map((item) => (
                <NavItem key={item.href + item.label} item={item} pathname={pathname} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Operations</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {operationsItems.map((item) => (
                <NavItem key={item.href + item.label} item={item} pathname={pathname} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Intelligence</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {intelligenceItems.map((item) => (
                <NavItem key={item.href + item.label} item={item} pathname={pathname} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="px-4 py-3 border-t border-border">
        {/* Analytics Settings, Product Mapping and Data Sync are tabs on one admin
            page — the owner shouldn't hunt across three nav entries for them. */}
        <Link
          href="/dashboard/settings"
          className={cn(
            "flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors",
            pathname.startsWith("/dashboard/settings") && "text-primary"
          )}
        >
          <Settings2 className="size-3.5" />
          <span>Settings</span>
        </Link>
        <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
          <MapPin className="size-3" />
          <span>Hyde Park & Grand Arcade</span>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
