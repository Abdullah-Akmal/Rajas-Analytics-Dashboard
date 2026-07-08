# Dashboard Pages

Every screen lives under `app/dashboard/`. The left nav (`components/dashboard-sidebar.tsx`) groups them into **Analytics**, **Operations** and **Intelligence**. All screens share the **DateLocationFilter** (date range + location, persisted across pages).

## Analytics
| Screen | Route | What it shows | Key actions |
|--------|-------|---------------|-------------|
| Overview | `/dashboard` | Headline KPIs, daily revenue trend, platform split, day×hour revenue heatmap | `getOverviewKPIs`, `getDailyRevenueTrend`, `getPlatformPerformance`, `getRevenueHeatmap` |
| Item Profitability | `/dashboard/costing` | Per-item cost/margin; Category Performance tab | `getItemProfitability`, `getCategoryPerformance` |
| Item Performance | `/dashboard/sales` | Item sales mix, search, ranking | `getItemProfitability`, `getTopItemsByPlatform` |
| Platform Analytics | `/dashboard/platforms` | Revenue/orders/AOV by platform | `getPlatformPerformance`, `getTopItemsByPlatform` |
| Offers & Discounts | `/dashboard/offers` | Discount usage & value | `getOfferAnalysis` |
| Offer Performance | `/dashboard/offer-performance` | Detailed offer uplift & margin impact | `getOfferAnalytics` |

## Operations
| Screen | Route | What it shows | Key actions |
|--------|-------|---------------|-------------|
| Hourly Demand | `/dashboard/demand` | Orders by hour / heatmap | `getHourlyDemand`, `getHourlyDemandHeatmap` |
| Delivery & Drivers | `/dashboard/delivery` | On-time %, driver performance, area analytics | `getDeliveryKPIs`, `getDeliveryPerformance`, `getDeliveryAreaAnalytics` |
| Basket & Upsell | `/dashboard/basket` | Items-per-order, item affinity, add-on attach rates, menu groups | `getBasketAnalysis`, `getBasketInsights` |
| Customer Insights | `/dashboard/customers` | Identified web customers, New/Returning/Regular segments + items per segment | `getCustomerInsights`, `getWebCustomerItemsBySegment` |

## Intelligence
| Screen | Route | What it shows | Key actions |
|--------|-------|---------------|-------------|
| Offer Recommendation | `/dashboard/recommendations` | Quiet/Mid/Peak periods from real opening hours, sales-by-hour chart, data-backed offer plans, high-profit bundle opportunities | `getHourlyBreakdown`, `getItemProfitability`, `getBasketAnalysis` |
| Decision Support | `/dashboard/decisions` | Consolidated strategic recommendations | mixed |
| Forecasting | `/dashboard/forecast` | Demand forecast | `getForecastData` |
| Alert System | `/dashboard/alerts` (badge "Live") | Threshold/anomaly alerts | mixed |
| Action Panel | `/dashboard/actions` (badge "Weekly") | Execution tracker for recommendations | `getActionItems`, `create/update/deleteActionItem` |
| Name Review | `/dashboard/review` (badge "Queue") | Normalisation review queue | `getReviewQueue`, `confirmAlias`, `getAllCanonicals` |

## System
| Screen | Route | What it shows |
|--------|-------|---------------|
| Sync | `/dashboard/sync` | Manual Presto/Shipday/Sheets sync, sync logs, backfill & clear tools |

### Notes
- **Offer Recommendation** derives demand periods from each location's real trading window — Grand Arcade 10:30am–4:00am, Hyde Park 11:00am–1:00am — then ranks each open hour ≥66% (peak) / ≤33% (quiet) / else (mid) of the busiest hour.
- **Category Performance** is a tab on the Item Profitability page (marked `secondary` in the nav), not its own route.
