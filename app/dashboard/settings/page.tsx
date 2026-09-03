"use client"

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { AnalyticsSettingsPanel } from "@/components/settings/analytics-settings-panel"
import { DriverShiftPanel } from "@/components/settings/driver-shift-panel"
import { OfferSetupPanel } from "@/components/settings/offer-setup-panel"
import ReviewPage from "@/app/dashboard/review/page"
import SyncPage from "@/app/dashboard/sync/page"

/**
 * Administrative area (spec §3 "Data Management" + §5 "Analytics Settings").
 *
 * The three admin surfaces the owner needs live behind one nav entry rather than
 * three: editable business assumptions, the name-mapping exception queue, and the
 * data syncs. Name Review and Data Sync keep their own routes so existing links
 * still work; here they render embedded, without their page-level headings.
 */
export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Business assumptions, product-name mapping and data synchronisation
        </p>
      </div>

      <Tabs defaultValue="settings">
        <TabsList>
          <TabsTrigger value="settings">Analytics Settings</TabsTrigger>
          <TabsTrigger value="mapping">Product Mapping</TabsTrigger>
          <TabsTrigger value="offers">Offer Setup</TabsTrigger>
          <TabsTrigger value="drivers">Driver Shifts</TabsTrigger>
          <TabsTrigger value="sync">Data Sync</TabsTrigger>
        </TabsList>

        <TabsContent value="settings" className="mt-4">
          <AnalyticsSettingsPanel />
        </TabsContent>

        <TabsContent value="mapping" className="mt-4">
          <ReviewPage embedded />
        </TabsContent>

        {/* §10: offer setup records — the funding split and dates that make offer
            contribution and incrementality computable. */}
        <TabsContent value="offers" className="mt-4">
          <OfferSetupPanel />
        </TabsContent>

        {/* §9: the manual Driver Shift Log, the only source of driver hours. */}
        <TabsContent value="drivers" className="mt-4">
          <DriverShiftPanel />
        </TabsContent>

        <TabsContent value="sync" className="mt-4">
          <SyncPage embedded />
        </TabsContent>
      </Tabs>
    </div>
  )
}
