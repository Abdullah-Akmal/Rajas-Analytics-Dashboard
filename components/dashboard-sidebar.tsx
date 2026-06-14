"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  TrendingUp,
  ShoppingCart,
  Truck,
  Clock,
  Tag,
  Users,
  Bell,
  Zap,
  RefreshCw,
  ChefHat,
  BarChart3,
  MapPin,
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

const navItems = [
  { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { label: "Profitability", href: "/dashboard/costing", icon: TrendingUp },
  { label: "Sales Performance", href: "/dashboard/sales", icon: BarChart3 },
  { label: "Platform Analytics", href: "/dashboard/platforms", icon: ShoppingCart },
  { label: "Hourly Demand", href: "/dashboard/demand", icon: Clock },
  { label: "Delivery & Drivers", href: "/dashboard/delivery", icon: Truck },
  { label: "Offers & Discounts", href: "/dashboard/offers", icon: Tag },
  { label: "Customer Insights", href: "/dashboard/customers", icon: Users },
  { label: "Alerts", href: "/dashboard/alerts", icon: Bell },
  { label: "Action Panel", href: "/dashboard/actions", icon: Zap },
]

export function DashboardSidebar() {
  const pathname = usePathname()

  return (
    <Sidebar>
      <SidebarHeader className="px-4 py-5 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-lg bg-primary flex items-center justify-center">
            <ChefHat className="size-5 text-primary-foreground" />
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
              {navItems.slice(0, 5).map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={pathname === item.href}
                    render={<Link href={item.href} />}
                  >
                    <item.icon className="size-4" />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Operations</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.slice(5, 8).map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={pathname === item.href}
                    render={<Link href={item.href} />}
                  >
                    <item.icon className="size-4" />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Intelligence</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.slice(8).map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={pathname === item.href}
                    render={<Link href={item.href} />}
                  >
                    <item.icon className="size-4" />
                    <span>{item.label}</span>
                    {item.label === "Alerts" && (
                      <Badge variant="destructive" className="ml-auto text-[10px] px-1.5 py-0">
                        Live
                      </Badge>
                    )}
                    {item.label === "Action Panel" && (
                      <Badge className="ml-auto text-[10px] px-1.5 py-0 bg-primary text-primary-foreground">
                        New
                      </Badge>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="px-4 py-3 border-t border-border">
        <Link
          href="/dashboard/sync"
          className={cn(
            "flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors",
            pathname === "/dashboard/sync" && "text-primary"
          )}
        >
          <RefreshCw className="size-3.5" />
          <span>Data Sync</span>
        </Link>
        <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
          <MapPin className="size-3" />
          <span>Hyde Park & Grand Arcade</span>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
