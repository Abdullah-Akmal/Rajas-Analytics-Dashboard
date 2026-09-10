"use server"

import { db } from "@/lib/db"
import { analyticsSettings, pricingSettings } from "@/lib/db/schema"
import { sql } from "drizzle-orm"
import {
  SETTINGS, STORES, CHANNELS, scopeId, isNumeric, type SettingDef,
} from "@/lib/settings/catalog"

function safeRevalidate(path: string) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("next/cache").revalidatePath(path)
  } catch {
    // no-op outside a Next.js request context
  }
}

export type ResolvedSetting = {
  key: string
  store: string | null
  channel: string | null
  /** Numeric for most settings; a string for "choice" units such as revenue_basis. */
  value: number | string
  /** Where this value came from — drives the "Default"/"Sheet"/"Edited" badge. */
  source: "override" | "sheet" | "default"
  updatedAt: string | null
}

/** Every setting the catalog defines, expanded across its scope, with values resolved. */
export async function getResolvedSettings(): Promise<ResolvedSetting[]> {
  const [overrides, sheet] = await Promise.all([
    db.select().from(analyticsSettings),
    db.select().from(pricingSettings),
  ])

  const overrideMap = new Map(
    overrides.map((o) => [scopeId(o.key, o.store, o.channel), o]),
  )
  const sheetByStore = new Map(sheet.map((s) => [s.store, s]))

  const out: ResolvedSetting[] = []

  const resolve = (def: SettingDef, store: string | null, channel: string | null) => {
    const id = scopeId(def.key, store, channel)
    const ov = overrideMap.get(id)
    if (ov) {
      out.push({
        key: def.key, store, channel,
        value: isNumeric(def) ? Number(ov.value) : ov.value,
        source: "override",
        updatedAt: ov.updatedAt ? new Date(ov.updatedAt).toISOString() : null,
      })
      return
    }
    // Fall back to the pricing sheet where it supplies this value, then the catalog default.
    if (def.seedFrom && store) {
      const row = sheetByStore.get(store) as Record<string, unknown> | undefined
      const raw = row?.[def.seedFrom]
      if (raw !== undefined && raw !== null && raw !== "") {
        out.push({ key: def.key, store, channel, value: Number(raw), source: "sheet", updatedAt: null })
        return
      }
    }
    out.push({ key: def.key, store, channel, value: def.default, source: "default", updatedAt: null })
  }

  for (const def of SETTINGS) {
    if (def.scope === "global") resolve(def, null, null)
    else if (def.scope === "perStore") for (const s of STORES) resolve(def, s, null)
    else for (const s of STORES) for (const c of CHANNELS) resolve(def, s, c)
  }
  return out
}

/** Write one setting override. Passing null clears it back to sheet/default. */
export async function updateSetting(
  key: string,
  store: string | null,
  channel: string | null,
  value: number | string | null,
) {
  const def = SETTINGS.find((s) => s.key === key)
  if (!def) return { success: false, error: `Unknown setting: ${key}` }

  try {
    if (value === null || (typeof value === "number" && Number.isNaN(value))) {
      await db.execute(sql`
        DELETE FROM analytics_settings
         WHERE key = ${key}
           AND store IS NOT DISTINCT FROM ${store}
           AND channel IS NOT DISTINCT FROM ${channel}`)
    } else {
      // No unique index across nullable columns behaves the way we want, so do an
      // explicit delete-then-insert — cheap at this table's size and unambiguous.
      await db.execute(sql`
        DELETE FROM analytics_settings
         WHERE key = ${key}
           AND store IS NOT DISTINCT FROM ${store}
           AND channel IS NOT DISTINCT FROM ${channel}`)
      await db.insert(analyticsSettings).values({
        key, store, channel, value: value.toString(), updatedAt: new Date(),
      })
    }
    safeRevalidate("/dashboard")
    safeRevalidate("/dashboard/settings")
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : "Unknown error" }
  }
}

/**
 * Server-side lookup for analytics queries.
 * Returns a getter: value(key, store?, channel?) → number, with the same
 * override → sheet → default precedence as the UI.
 */
export async function getSettingsLookup() {
  const resolved = await getResolvedSettings()
  const map = new Map(resolved.map((r) => [scopeId(r.key, r.store, r.channel), r.value]))

  const raw = (key: string, store?: string | null, channel?: string | null) => {
    const exact = map.get(scopeId(key, store ?? null, channel ?? null))
    if (exact !== undefined) return exact
    // A store-scoped setting asked for without a store falls back to the catalog default.
    return SETTINGS.find((s) => s.key === key)?.default ?? 0
  }

  const fn = (key: string, store?: string | null, channel?: string | null): number =>
    Number(raw(key, store, channel)) || 0
  /** For "choice" settings such as revenue_basis, where the value is a string key. */
  fn.text = (key: string, store?: string | null, channel?: string | null): string =>
    String(raw(key, store, channel))
  /** For "boolean" settings, persisted as 1/0. */
  fn.bool = (key: string, store?: string | null, channel?: string | null): boolean =>
    Number(raw(key, store, channel)) === 1

  return fn
}
