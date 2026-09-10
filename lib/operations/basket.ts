"use server"

import { db } from "@/lib/db"
import { sql } from "drizzle-orm"
import { normKey, rawItemSlicers, rawPmSlicers, MARKETPLACE_CHANNELS, type PmFilters } from "@/lib/db/slicers"
import { getSettingsLookup } from "@/lib/settings/actions"
import { getRevenueBasis } from "@/lib/analytics/revenue-basis"
import { lineGroupSql } from "@/lib/operations/basket-rules"

/**
 * Basket Growth / Add-on Opportunities (Operations corrections §6).
 *
 * The point of this page is GENUINE extra items added on top of the customer's
 * chosen meal or order. How the POS records a meal decides everything here:
 *
 *   Any 12inch Pizza Meal     £18.00   ← the meal (paid)
 *   Meat Supreme Pizza         £0.00   ← included component
 *   Irn-Bru (0.33L)            £0.00   ← included component
 *   Large Fries                £0.00   ← included component
 *
 *   Peri Peri Chicken Burger   £5.50
 *   Make It a Meal (S & D)     £2.00   ← solo → meal upgrade
 *   Vimto (0.33L)              £0.00   ← included component of that upgrade
 *
 * So (item 25/26):
 *   • £0 lines are included meal components — never an attachment.
 *   • "Make it a Meal" lines are a meal upgrade — NOT a side + drink attachment (the
 *     old logic credited them as both, which counted meal components as upsells) and
 *     not a Solo-to-Meal module, which the brief explicitly parks.
 *   • A genuine add-on is a PAID side / dessert / shake / drink / dip / extra chicken /
 *     premium upgrade line in an order that also contains a main.
 *
 * Economics come from the live Product Master cost (Supplier → Recipe → Item Cost →
 * Product Master), never a separate cost table (item 35 / §2).
 */

export type AddonGroup = "Side" | "Dessert & Shakes" | "Drink" | "Dip" | "Extra Chicken" | "Extras & Upgrades"
const ADDON_GROUPS: AddonGroup[] = ["Side", "Dessert & Shakes", "Drink", "Dip", "Extra Chicken", "Extras & Upgrades"]

export type BasketAction = { tone: "good" | "warning" | "problem" | "neutral"; label: string; text: string }

export type BasketGrowthResult = {
  revenueLabel: string
  kpis: {
    orders: number
    aov: number
    itemsPerOrder: number
    mainOrders: number
    addonOrders: number
    addonAttachPct: number
  }
  distribution: Array<{ bucket: string; orders: number; pct: number }>
  groups: Array<{
    group: AddonGroup
    attachedOrders: number
    attachPct: number
    aovWith: number
    aovWithout: number
    associatedLift: number
    revenue: number
    foodCostPct: number | null
    costedPct: number
  }>
  addonItems: Array<{
    item: string
    group: AddonGroup
    attachedOrders: number
    attachPct: number
    revenue: number
    foodCostPct: number | null
    target: number
    gpPerUnit: number | null
    economics: "good" | "poor" | "no_cost"
  }>
  pairs: Array<{
    itemA: string
    itemB: string
    kind: string
    pairOrders: number
    lift: number
    status: "ok" | "insufficient"
  }>
  minPairOrders: number
  actions: BasketAction[]
  caveats: string[]
}


export async function getBasketGrowth(
  startDate: string,
  endDate: string,
  location?: string,
  channel?: string,
  mode?: string,
  platform?: string,
  pm?: PmFilters,
): Promise<BasketGrowthResult> {
  const setting = await getSettingsLookup()
  const rb = await getRevenueBasis()
  const minPairOrders = Math.max(1, Math.round(setting("basket_min_pair_orders")))
  const store = location && location !== "all" ? location : null

  // Per-line food-cost target, the same rule Analytics uses (in-store vs platform).
  const t = {
    hpIn: setting("target_food_cost_pct", "Hyde Park"),
    hpPl: setting("platform_target_food_cost_pct", "Hyde Park"),
    gaIn: setting("target_food_cost_pct", "Grand Arcade"),
    gaPl: setting("platform_target_food_cost_pct", "Grand Arcade"),
    hpAmber: setting("amber_tolerance_pct", "Hyde Park"),
    gaAmber: setting("amber_tolerance_pct", "Grand Arcade"),
  }
  const marketplaces = sql.join(MARKETPLACE_CHANNELS.map((c) => sql`${c}`), sql`, `)
  const lineTarget = sql`CASE
    WHEN lower(COALESCE(oi."orderChannel", '')) IN (${marketplaces})
      THEN CASE WHEN oi.location = 'Hyde Park' THEN ${t.hpPl}::numeric ELSE ${t.gaPl}::numeric END
      ELSE CASE WHEN oi.location = 'Hyde Park' THEN ${t.hpIn}::numeric ELSE ${t.gaIn}::numeric END
  END`
  const lineAmber = sql`CASE WHEN oi.location = 'Hyde Park' THEN ${t.hpAmber}::numeric ELSE ${t.gaAmber}::numeric END`
  const revenue = rb.basis === "gross"
    ? sql`oi.amount::numeric`
    : sql`GREATEST(oi.amount::numeric - COALESCE(oi."vatAmount"::numeric, 0), 0)`

  const grp = sql.raw(lineGroupSql(`oi."itemName"`, `COALESCE(oi."categoryName", '')`, `pmx."productType"`))

  // Paid lines in scope, each resolved to ONE Product Master row. The alias lookup is
  // deduped per normalised key so a line can never join twice and double its revenue.
  const linesCte = sql`
    alias1 AS (
      SELECT DISTINCT ON (lower(ia."normalizedRaw")) lower(ia."normalizedRaw") AS nk, ia."productMasterId" AS pmid
        FROM item_alias ia
       WHERE ia."productMasterId" IS NOT NULL
       ORDER BY lower(ia."normalizedRaw"), ia.reviewed DESC, ia.id
    ),
    lines AS (
      SELECT oi."orderId",
             btrim(oi."itemName")                    AS item,
             (${grp})                                AS grp,
             pmx.brand                               AS brand,
             oi.qty::numeric                         AS qty,
             ${revenue}                              AS rev,
             oi.qty::numeric * pmx."currentCost"     AS cost,
             ${lineTarget}                           AS target,
             ${lineAmber}                            AS amber
        FROM order_items oi
        LEFT JOIN alias1 a ON a.nk = ${normKey(sql`oi."itemName"`)}
        LEFT JOIN product_master pmx ON pmx.id = a.pmid
       WHERE oi.cancelled = false
         AND oi.amount::numeric > 0
         AND oi.date::date >= ${startDate}::date
         AND oi.date::date <= ${endDate}::date
         ${store ? sql` AND oi.location = ${store}` : sql``}
         ${rawItemSlicers("oi", channel, mode, platform)}
         ${rawPmSlicers("oi", pm)}
    ),
    ord AS (
      SELECT l."orderId",
             MAX(o."totalAmount"::numeric)                                     AS basket,
             COUNT(DISTINCT l.item) FILTER (WHERE l.grp <> 'MealUpgrade')      AS products,
             bool_or(l.grp = 'Main')                                           AS has_core_main,
             bool_or(l.grp = 'Extra Chicken')                                  AS has_chicken
        FROM lines l JOIN orders o ON o."orderId" = l."orderId"
       GROUP BY l."orderId"
    ),
    -- An order "has a main" when it has a core main, or when chicken is all it bought
    -- (then the chicken IS the main). Extra chicken only counts as an add-on on top of
    -- another main.
    mains AS (
      SELECT "orderId", basket, has_core_main FROM ord WHERE has_core_main OR has_chicken
    ),
    addon_lines AS (
      SELECT l.* FROM lines l JOIN mains m ON m."orderId" = l."orderId"
       WHERE l.grp NOT IN ('Main', 'MealUpgrade')
         AND (l.grp <> 'Extra Chicken' OR m.has_core_main)
    )`

  const [kpiRes, distRes, groupRes, itemRes, pairRes] = await Promise.all([
    db.execute<{ orders: string; aov: string; items: string; main_orders: string; addon_orders: string }>(sql`
      WITH ${linesCte}
      SELECT (SELECT COUNT(*) FROM ord)::text                                      AS orders,
             (SELECT COALESCE(AVG(basket), 0) FROM ord)::text                      AS aov,
             (SELECT COALESCE(AVG(products), 0) FROM ord)::text                    AS items,
             (SELECT COUNT(*) FROM mains)::text                                    AS main_orders,
             (SELECT COUNT(DISTINCT "orderId") FROM addon_lines)::text             AS addon_orders`),
    db.execute<{ bucket: string; n: string }>(sql`
      WITH ${linesCte}
      SELECT CASE WHEN products <= 1 THEN '1 item' WHEN products = 2 THEN '2 items' ELSE '3+ items' END AS bucket,
             COUNT(*)::text AS n
        FROM ord GROUP BY 1`),
    db.execute<{ grp: string; attached: string; aov_with: string; aov_without: string; rev: string; cost: string; costed_rev: string }>(sql`
      WITH ${linesCte},
      per AS (
        SELECT m."orderId", m.basket, g.grp,
               EXISTS (SELECT 1 FROM addon_lines al WHERE al."orderId" = m."orderId" AND al.grp = g.grp) AS has
          FROM mains m CROSS JOIN (SELECT unnest(ARRAY[${sql.join(ADDON_GROUPS.map((g) => sql`${g}`), sql`, `)}]) AS grp) g
      ),
      econ AS (
        SELECT grp, SUM(rev) AS rev, SUM(cost) AS cost, SUM(rev) FILTER (WHERE cost IS NOT NULL) AS costed_rev
          FROM addon_lines GROUP BY grp
      )
      SELECT per.grp,
             COUNT(*) FILTER (WHERE has)::text                     AS attached,
             COALESCE(AVG(basket) FILTER (WHERE has), 0)::text      AS aov_with,
             COALESCE(AVG(basket) FILTER (WHERE NOT has), 0)::text  AS aov_without,
             COALESCE(MAX(econ.rev), 0)::text                       AS rev,
             COALESCE(MAX(econ.cost), 0)::text                      AS cost,
             COALESCE(MAX(econ.costed_rev), 0)::text                AS costed_rev
        FROM per LEFT JOIN econ ON econ.grp = per.grp
       GROUP BY per.grp`),
    db.execute<{ item: string; grp: string; attached: string; rev: string; cost: string | null; units: string; target: string; amber: string }>(sql`
      WITH ${linesCte}
      SELECT item, MIN(grp) AS grp,
             COUNT(DISTINCT "orderId")::text                           AS attached,
             SUM(rev)::text                                            AS rev,
             CASE WHEN bool_and(cost IS NOT NULL) THEN SUM(cost)::text END AS cost,
             SUM(qty)::text                                            AS units,
             (SUM(rev * target) / NULLIF(SUM(rev), 0))::text           AS target,
             (SUM(rev * amber) / NULLIF(SUM(rev), 0))::text            AS amber
        FROM addon_lines
       GROUP BY item
       ORDER BY COUNT(DISTINCT "orderId") DESC
       LIMIT 15`),
    // Frequently bought together — genuine products only: £0 components and meal
    // upgrades are already excluded from `lines`, so no pair can be two parts of the
    // same meal. Pairs across different mapped brands are dropped (item 36): a
    // virtual-brand product must not be recommended alongside another brand's.
    db.execute<{ a: string; b: string; ga: string; gb: string; n: string; lift: string }>(sql`
      WITH ${linesCte},
      prod AS (
        SELECT DISTINCT "orderId", item, grp, brand FROM lines WHERE grp <> 'MealUpgrade'
      ),
      item_orders AS (SELECT item, COUNT(*) AS n FROM prod GROUP BY item),
      tot AS (SELECT COUNT(DISTINCT "orderId") AS n FROM prod),
      pairs AS (
        SELECT a.item AS a, b.item AS b, MIN(a.grp) AS ga, MIN(b.grp) AS gb, COUNT(*) AS n
          FROM prod a JOIN prod b ON a."orderId" = b."orderId" AND a.item < b.item
         WHERE (a.brand IS NULL OR b.brand IS NULL OR a.brand = b.brand)
           -- A genuine commercial combination has a main in it. Two sauces or two
           -- extras bought together are condiment habits, not a bundle candidate.
           AND (a.grp IN ('Main', 'Extra Chicken') OR b.grp IN ('Main', 'Extra Chicken'))
         GROUP BY a.item, b.item
      )
      SELECT p.a, p.b, p.ga, p.gb, p.n::text,
             ROUND((p.n::numeric * t.n) / NULLIF(ia.n::numeric * ib.n, 0), 2)::text AS lift
        FROM pairs p
        JOIN item_orders ia ON ia.item = p.a
        JOIN item_orders ib ON ib.item = p.b
        CROSS JOIN tot t
       WHERE p.n >= 2
       ORDER BY p.n DESC
       LIMIT 12`),
  ])

  const k = kpiRes.rows[0]
  const orders = Number(k?.orders ?? 0)
  const mainOrders = Number(k?.main_orders ?? 0)
  const addonOrders = Number(k?.addon_orders ?? 0)
  const kpis = {
    orders,
    aov: Number(k?.aov ?? 0),
    itemsPerOrder: Number(k?.items ?? 0),
    mainOrders,
    addonOrders,
    addonAttachPct: mainOrders > 0 ? (addonOrders / mainOrders) * 100 : 0,
  }

  const distMap = new Map(distRes.rows.map((r) => [r.bucket, Number(r.n)]))
  const distribution = ["1 item", "2 items", "3+ items"].map((bucket) => {
    const n = distMap.get(bucket) ?? 0
    return { bucket, orders: n, pct: orders > 0 ? (n / orders) * 100 : 0 }
  })

  const groups = ADDON_GROUPS.map((g) => {
    const r = groupRes.rows.find((x) => x.grp === g)
    const attached = Number(r?.attached ?? 0)
    const rev = Number(r?.rev ?? 0)
    const cost = Number(r?.cost ?? 0)
    const costedRev = Number(r?.costed_rev ?? 0)
    const aovWith = Number(r?.aov_with ?? 0)
    const aovWithout = Number(r?.aov_without ?? 0)
    return {
      group: g,
      attachedOrders: attached,
      attachPct: mainOrders > 0 ? (attached / mainOrders) * 100 : 0,
      aovWith,
      aovWithout,
      associatedLift: attached > 0 ? aovWith - aovWithout : 0,
      revenue: rev,
      // FC% only over revenue that actually has a live cost, so a missing cost
      // can never read as a cheap product.
      foodCostPct: costedRev > 0 ? cost / costedRev : null,
      costedPct: rev > 0 ? (costedRev / rev) * 100 : 0,
    }
  })

  const addonItems = itemRes.rows.map((r) => {
    const rev = Number(r.rev ?? 0)
    const units = Number(r.units ?? 0)
    const cost = r.cost === null ? null : Number(r.cost)
    const target = Number(r.target ?? 0.33)
    const amber = Number(r.amber ?? 0.03)
    const fc = cost !== null && rev > 0 ? cost / rev : null
    const attached = Number(r.attached)
    return {
      item: r.item,
      group: r.grp as AddonGroup,
      attachedOrders: attached,
      attachPct: mainOrders > 0 ? (attached / mainOrders) * 100 : 0,
      revenue: rev,
      foodCostPct: fc,
      target,
      gpPerUnit: cost !== null && units > 0 ? (rev - cost) / units : null,
      economics: (fc === null ? "no_cost" : fc <= target + amber ? "good" : "poor") as "good" | "poor" | "no_cost",
    }
  })

  const kindOf = (g: string) => (g === "Main" || g === "Extra Chicken" ? "Main" : "Add-on")
  const pairs = pairRes.rows.map((r) => {
    const n = Number(r.n)
    const ka = kindOf(r.ga), kb = kindOf(r.gb)
    return {
      itemA: r.a,
      itemB: r.b,
      kind: ka === kb ? `${ka} + ${kb}` : "Main + Add-on",
      pairOrders: n,
      lift: Number(r.lift ?? 0),
      status: (n >= minPairOrders ? "ok" : "insufficient") as "ok" | "insufficient",
    }
  })

  // ── Basket Growth Actions (item 37): top 3-5 only, economics-gated (item 35) ──
  const actions: BasketAction[] = []
  const caveats: string[] = []
  const itemEcon = new Map(addonItems.map((i) => [i.item, i]))

  // 1. Low-attach groups with a positive associated lift AND acceptable food cost.
  const promotable = groups
    .filter((g) => g.attachedOrders >= minPairOrders && g.associatedLift > 0)
    .filter((g) => g.foodCostPct !== null && g.costedPct >= 80)
    .filter((g) => {
      const items = addonItems.filter((i) => i.group === g.group)
      return items.length === 0 || items.some((i) => i.economics === "good")
    })
    .sort((a, b) => a.attachPct - b.attachPct)
  for (const g of promotable.slice(0, 2)) {
    const best = addonItems.find((i) => i.group === g.group && i.economics === "good")
    actions.push({
      tone: "good",
      label: "Prompt add-on",
      text:
        `${g.group}: added to ${g.attachPct.toFixed(1)}% of main orders. Baskets with one average ` +
        `£${g.aovWith.toFixed(2)} vs £${g.aovWithout.toFixed(2)} without — an associated difference, ` +
        `not proven extra revenue.` +
        (best ? ` ${best.item} has the healthiest economics (FC ${(best.foodCostPct! * 100).toFixed(0)}%).` : ""),
    })
  }

  // 2. Popular add-ons whose food cost is past target: fix before pushing them.
  for (const i of addonItems.filter((x) => x.economics === "poor").slice(0, 2)) {
    actions.push({
      tone: "warning",
      label: "Check economics",
      text:
        `${i.item} is a frequent add-on (${i.attachedOrders} orders) but runs at ` +
        `${(i.foodCostPct! * 100).toFixed(0)}% food cost vs a ${(i.target * 100).toFixed(0)}% target. ` +
        `Review its price or cost before promoting it.`,
    })
  }

  // 3. The strongest genuine combination that clears the evidence threshold.
  const combo = pairs.find((p) => {
    if (p.status !== "ok" || p.kind !== "Main + Add-on" || p.lift <= 1) return false
    const ea = itemEcon.get(p.itemA), eb = itemEcon.get(p.itemB)
    return (ea?.economics ?? "good") !== "poor" && (eb?.economics ?? "good") !== "poor"
  })
  if (combo) {
    actions.push({
      tone: "neutral",
      label: "Combination",
      text:
        `${combo.itemA} + ${combo.itemB} are bought together in ${combo.pairOrders} orders ` +
        `(${combo.lift.toFixed(1)}× more than chance). Candidate for a named combo or a checkout prompt — test it before calling it incremental.`,
    })
  }

  const noCost = addonItems.filter((i) => i.economics === "no_cost")
  if (noCost.length > 0) {
    actions.push({
      tone: "warning",
      label: "Map costs",
      text:
        `${noCost.length} frequent add-on${noCost.length > 1 ? "s have" : " has"} no live cost ` +
        `(${noCost.slice(0, 3).map((i) => i.item).join(", ")}${noCost.length > 3 ? "…" : ""}). ` +
        `Map ${noCost.length > 1 ? "them" : "it"} in Product Mapping — no recommendation is made on an unknown cost.`,
    })
    caveats.push(`${noCost.length} of the top add-on items have no live cost, so their food cost is unknown.`)
  }
  if (actions.length === 0) {
    actions.push({ tone: "neutral", label: "No action", text: "No add-on clears both the evidence threshold and the food-cost check in this selection." })
  }

  return {
    revenueLabel: rb.label,
    kpis,
    distribution,
    groups,
    addonItems,
    pairs,
    minPairOrders,
    actions: actions.slice(0, 5),
    caveats,
  }
}
