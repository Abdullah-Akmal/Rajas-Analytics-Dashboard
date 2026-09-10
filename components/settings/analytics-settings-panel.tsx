"use client"

import { useEffect, useState } from "react"
import { getResolvedSettings, updateSetting, type ResolvedSetting } from "@/lib/settings/actions"
import {
  SETTINGS, SETTING_GROUPS, STORES, CHANNELS, CHANNEL_LABELS,
  scopeId, toDisplay, fromDisplay, unitSuffix, isNumeric,
  type SettingDef, type SettingGroup,
} from "@/lib/settings/catalog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { RotateCcw, Check } from "lucide-react"

type Draft = Record<string, string>

export function AnalyticsSettingsPanel() {
  const [rows, setRows] = useState<ResolvedSetting[]>([])
  const [draft, setDraft] = useState<Draft>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [saved, setSaved] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)

  const load = async () => {
    const r = await getResolvedSettings()
    setRows(r)
    const d: Draft = {}
    for (const row of r) {
      const def = SETTINGS.find((s) => s.key === row.key)
      if (!def) continue
      d[scopeId(row.key, row.store, row.channel)] = isNumeric(def)
        ? String(toDisplay(def, Number(row.value)))
        : String(row.value)
    }
    setDraft(d)
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const commit = async (def: SettingDef, store: string | null, channel: string | null, override?: string) => {
    const id = scopeId(def.key, store, channel)
    const rawValue = override ?? draft[id]
    let toStore: number | string
    if (isNumeric(def)) {
      const shown = parseFloat(rawValue)
      if (Number.isNaN(shown)) return
      toStore = fromDisplay(def, shown)
    } else {
      toStore = rawValue
    }
    setSaving((p) => ({ ...p, [id]: true }))
    const res = await updateSetting(def.key, store, channel, toStore)
    setSaving((p) => ({ ...p, [id]: false }))
    if (res.success) {
      setSaved((p) => ({ ...p, [id]: true }))
      setTimeout(() => setSaved((p) => ({ ...p, [id]: false })), 1600)
      load()
    }
  }

  const reset = async (def: SettingDef, store: string | null, channel: string | null) => {
    const id = scopeId(def.key, store, channel)
    setSaving((p) => ({ ...p, [id]: true }))
    await updateSetting(def.key, store, channel, null)
    setSaving((p) => ({ ...p, [id]: false }))
    load()
  }

  const find = (key: string, store: string | null, channel: string | null) =>
    rows.find((r) => r.key === key && r.store === store && r.channel === channel)

  const Field = ({ def, store, channel, label }: {
    def: SettingDef; store: string | null; channel: string | null; label: string
  }) => {
    const id = scopeId(def.key, store, channel)
    const row = find(def.key, store, channel)
    const dirty = row
      ? (isNumeric(def) ? String(toDisplay(def, Number(row.value))) : String(row.value)) !== draft[id]
      : false
    if (!isNumeric(def)) {
      const opts = def.unit === "boolean"
        ? [{ value: "1", label: "Yes" }, { value: "0", label: "No" }]
        : def.options ?? []
      return (
        <div className="flex items-center gap-3 py-2">
          <div className="w-40 shrink-0 text-xs text-muted-foreground">{label}</div>
          <Select
            value={draft[id] ?? ""}
            onValueChange={(v) => {
              if (!v) return
              setDraft((p) => ({ ...p, [id]: v }))
              commit(def, store, channel, v)
            }}
          >
            <SelectTrigger className="h-8 text-sm w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              {opts.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {row && (
            <Badge variant={row.source === "override" ? "default" : "outline"} className="text-xs px-1.5 py-0">
              {row.source === "override" ? "Edited" : row.source === "sheet" ? "From sheet" : "Default"}
            </Badge>
          )}
          {saving[id] && <span className="text-xs text-muted-foreground">saving…</span>}
          {saved[id] && <Check className="size-3.5 text-success" />}
          {row?.source === "override" && (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => reset(def, store, channel)}>
              <RotateCcw className="size-3 mr-1" /> Reset
            </Button>
          )}
        </div>
      )
    }

    return (
      <div className="flex items-center gap-3 py-2">
        <div className="w-40 shrink-0 text-xs text-muted-foreground">{label}</div>
        <div className="relative w-36">
          <Input
            className="h-8 pr-10 text-sm"
            value={draft[id] ?? ""}
            onChange={(e) => setDraft((p) => ({ ...p, [id]: e.target.value }))}
            onBlur={() => dirty && commit(def, store, channel)}
            onKeyDown={(e) => { if (e.key === "Enter") commit(def, store, channel) }}
            inputMode="decimal"
          />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {unitSuffix(def)}
          </span>
        </div>
        {row && (
          <Badge
            variant={row.source === "override" ? "default" : "outline"}
            className="text-xs px-1.5 py-0"
          >
            {row.source === "override" ? "Edited" : row.source === "sheet" ? "From sheet" : "Default"}
          </Badge>
        )}
        {saving[id] && <span className="text-xs text-muted-foreground">saving…</span>}
        {saved[id] && <Check className="size-3.5 text-success" />}
        {row?.source === "override" && (
          <Button
            size="sm" variant="ghost" className="h-7 px-2 text-xs"
            onClick={() => reset(def, store, channel)}
            title="Clear the override and fall back to the sheet or default"
          >
            <RotateCcw className="size-3 mr-1" /> Reset
          </Button>
        )}
      </div>
    )
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading settings…</p>

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Business assumptions used across the dashboard. Editing a value here changes every
        calculation that depends on it — no developer needed. Values fall back to the pricing
        sheet where it supplies one, then to a built-in default.
      </p>

      {SETTING_GROUPS.map((group: SettingGroup) => {
        const defs = SETTINGS.filter((s) => s.group === group)
        if (defs.length === 0) return null
        return (
          <Card key={group}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{group}</CardTitle>
              {group === "Hyde Park Drivers" && (
                <CardDescription className="text-xs">
                  Direct Hyde Park deliveries only. Driver hours come from the manual shift log.
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="flex flex-col divide-y divide-border/50">
              {defs.map((def) => (
                <div key={def.key} className="py-2 first:pt-0 last:pb-0">
                  <div className="flex flex-col gap-0.5 mb-1">
                    <span className="text-sm font-medium text-foreground">{def.label}</span>
                    {def.help && <span className="text-sm text-muted-foreground">{def.help}</span>}
                  </div>
                  {def.scope === "global" && (
                    <Field def={def} store={null} channel={null} label="All stores" />
                  )}
                  {def.scope === "perStore" && STORES.map((s) => (
                    <Field key={s} def={def} store={s} channel={null} label={s} />
                  ))}
                  {def.scope === "perChannel" && STORES.map((s) => (
                    <div key={s} className="mt-1">
                      <div className="text-sm font-medium text-foreground/80 mt-2">{s}</div>
                      {CHANNELS.map((c) => (
                        <Field key={c} def={def} store={s} channel={c} label={CHANNEL_LABELS[c]} />
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
