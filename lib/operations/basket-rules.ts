/**
 * Add-on classification for a PAID order line (Operations corrections items 25-26).
 *
 * Kept in a plain module (not "use server") so the Basket Growth query and any
 * verification script apply the identical rule. £0 lines never reach this: they are
 * included meal components and are filtered out before classification.
 *
 * Returns 'MealUpgrade' (a solo → meal upgrade; neither a main nor an add-on),
 * 'Main', or one of the add-on groups. Product Mapping decides first (productType from
 * the Product Master); the POS category is the fallback — so a mapping fix in Settings
 * changes the classification without a code change.
 */
export function lineGroupSql(nameCol: string, catCol: string, typeCol: string) {
  return `CASE
    WHEN ${nameCol} ILIKE '%make it a meal%' OR ${nameCol} ILIKE '%meal (%drink%'
         OR btrim(${nameCol}) ILIKE 'meal' OR btrim(${nameCol}) ILIKE 'meal (%'
      THEN 'MealUpgrade'
    WHEN ${typeCol} IN ('meal', 'deal') THEN 'Main'
    WHEN ${catCol} ~* '(dessert|sundae|ice cream|cake|pudding|shake|cookie|waffle|churro|brownie)'
         OR ${nameCol} ~* '(milkshake|sundae|cheesecake|brownie)' THEN 'Dessert & Shakes'
    WHEN ${catCol} ~* '(dip|sauce)' THEN 'Dip'
    WHEN ${typeCol} = 'drink' OR ${catCol} ~* '(drink|soft|juice|water)' THEN 'Drink'
    WHEN ${typeCol} = 'addon' OR btrim(${catCol}) ~* '^(extras?|extras? & add[- ]?ons|add price|add ingredients|crust|size|online hidden|piri piri|toppings?)$'
         OR ${nameCol} ILIKE 'upgrade to%' OR ${nameCol} ILIKE 'extra %' OR ${nameCol} ILIKE 'add %'
      THEN 'Extras & Upgrades'
    WHEN ${typeCol} = 'side' OR ${catCol} ~* '(side|fries|garlic bread|loaded|snack)' THEN 'Side'
    WHEN ${catCol} ~* '(wings or strips|^wings|strips|nuggets)' THEN 'Extra Chicken'
    ELSE 'Main'
  END`
}
