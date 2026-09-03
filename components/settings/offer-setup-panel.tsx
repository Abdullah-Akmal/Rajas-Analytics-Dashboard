"use client"

import { useEffect, useState } from "react"
import { listOffers, createOffer, deleteOffer, getOfferCandidateCategories } from "@/lib/analytics/offer-admin"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Trash2, Plus } from "lucide-react"
import { format } from "date-fns"

type OfferRow = {
  id: number; offerId: string; name: string; channel: string | null; store: string | null
  startDate: string; endDate: string | null; discountPercent: string | null
  rajasFundingPct: string | null; platformFundingPct: string | null; posCategories: string | null
}
type Candidate = { cat: string; revenue: string; discount: string }

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-1">
    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
    {children}
  </div>
)

/**
 * Offer setup records (spec §10).
 *
 * Two fields here are what turn the Offers page from descriptive into commercial:
 * the Raja's funding % (who actually paid for the discount) and the start/end dates
 * (which make a comparable baseline, and therefore incrementality, computable).
 */
export function OfferSetupPanel() {
  const [offers, setOffers] = useState<OfferRow[]>([])
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [form, setForm] = useState({
    offerId: "", name: "", channel: "all", store: "all",
    startDate: format(new Date(), "yyyy-MM-dd"), endDate: "",
    discountPercent: "", rajasFundingPct: "100", posCategories: "",
  })

  const load = async () => {
    const [o, c] = await Promise.all([listOffers(), getOfferCandidateCategories()])
    setOffers(o as unknown as OfferRow[])
    setCandidates(c as unknown as Candidate[])
  }
  useEffect(() => { load() }, [])

  const submit = async () => {
    setSaving(true); setError("")
    const res = await createOffer({
      offerId: form.offerId,
      name: form.name,
      channel: form.channel,
      store: form.store,
      startDate: form.startDate,
      endDate: form.endDate || undefined,
      discountPercent: form.discountPercent ? Number(form.discountPercent) : undefined,
      rajasFundingPct: form.rajasFundingPct ? Number(form.rajasFundingPct) : 100,
      posCategories: form.posCategories,
    })
    setSaving(false)
    if (!res.success) { setError(res.error ?? "Could not save"); return }
    setForm((f) => ({ ...f, offerId: "", name: "", posCategories: "", discountPercent: "" }))
    load()
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Add an offer</CardTitle>
          <CardDescription className="text-xs">
            Every meaningful offer needs an Offer ID and setup record. The funding split
            decides how much of a discount actually costs Raja&apos;s, and the dates are
            what let incremental contribution be estimated against a baseline.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Offer ID">
              <Input className="h-8 text-xs w-44" placeholder="UBER-20OFF-AUG26"
                value={form.offerId} onChange={(e) => setForm((f) => ({ ...f, offerId: e.target.value }))} />
            </Field>
            <Field label="Name">
              <Input className="h-8 text-xs w-36" placeholder="20% Uber"
                value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </Field>
            <Field label="Channel">
              <Select value={form.channel} onValueChange={(v) => setForm((f) => ({ ...f, channel: v ?? "all" }))}>
                <SelectTrigger className="h-8 text-xs w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All channels</SelectItem>
                  <SelectItem value="wix">In-store</SelectItem>
                  <SelectItem value="eatpresto">Wix / Direct</SelectItem>
                  <SelectItem value="ubereats">Uber Eats</SelectItem>
                  <SelectItem value="deliveroo">Deliveroo</SelectItem>
                  <SelectItem value="justeat">Just Eat</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Start">
              <Input type="date" className="h-8 text-xs w-36"
                value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
            </Field>
            <Field label="End">
              <Input type="date" className="h-8 text-xs w-36"
                value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
            </Field>
            <Field label="Discount %">
              <Input className="h-8 text-xs w-24" inputMode="decimal" placeholder="20"
                value={form.discountPercent} onChange={(e) => setForm((f) => ({ ...f, discountPercent: e.target.value }))} />
            </Field>
            <Field label="Raja's funding %">
              <Input className="h-8 text-xs w-28" inputMode="decimal"
                value={form.rajasFundingPct} onChange={(e) => setForm((f) => ({ ...f, rajasFundingPct: e.target.value }))} />
            </Field>
            <Field label="POS categories">
              <Input className="h-8 text-xs w-52" placeholder="OFFERS, BUY ONE GET ONE FREE"
                value={form.posCategories} onChange={(e) => setForm((f) => ({ ...f, posCategories: e.target.value }))} />
            </Field>
            <Button size="sm" className="h-8" onClick={submit} disabled={saving || !form.offerId.trim() || !form.name.trim()}>
              <Plus className="size-3.5 mr-1" />{saving ? "Saving…" : "Add offer"}
            </Button>
          </div>
          {error && <p className="text-xs text-destructive mt-2">{error}</p>}

          {candidates.length > 0 && (
            <div className="mt-4">
              <p className="text-[11px] text-muted-foreground mb-1.5">
                POS categories currently carrying discounts — click to fill the mapping field:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {candidates.slice(0, 12).map((c) => (
                  <Badge
                    key={c.cat} variant="outline"
                    className="text-[10px] cursor-pointer hover:bg-secondary"
                    onClick={() => setForm((f) => ({
                      ...f,
                      posCategories: f.posCategories ? `${f.posCategories}, ${c.cat}` : c.cat,
                    }))}
                  >
                    {c.cat} · £{c.discount}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Configured offers</CardTitle>
        </CardHeader>
        <CardContent>
          {offers.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No offers configured. Until at least one exists, every discount is attributed
              to Raja&apos;s in full and incremental contribution shows as N/A.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Offer ID</TableHead>
                  <TableHead className="text-xs">Name</TableHead>
                  <TableHead className="text-xs">Channel</TableHead>
                  <TableHead className="text-xs">Window</TableHead>
                  <TableHead className="text-xs text-right">Raja&apos;s / Platform</TableHead>
                  <TableHead className="text-xs">Mapped categories</TableHead>
                  <TableHead className="text-xs" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {offers.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="text-xs font-mono">{o.offerId}</TableCell>
                    <TableCell className="text-xs font-medium">{o.name}</TableCell>
                    <TableCell className="text-xs">{o.channel ?? "All"}</TableCell>
                    <TableCell className="text-xs">{o.startDate} → {o.endDate ?? "open"}</TableCell>
                    <TableCell className="text-xs text-right">
                      {Number(o.rajasFundingPct ?? 100).toFixed(0)}% / {Number(o.platformFundingPct ?? 0).toFixed(0)}%
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{o.posCategories ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => deleteOffer(o.id).then(load)}>
                        <Trash2 className="size-3 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
