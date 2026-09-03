/**
 * Pure product-type classification (spec §3).
 *
 * Kept out of actions.ts because a "use server" module may only export async
 * functions — exporting this synchronous helper from there fails the build.
 */

/** Product types recognised by the spec (§3). */
export type ProductType =
  | "solo" | "meal" | "deal" | "side" | "drink"
  | "addon" | "modifier" | "meal_upgrade" | "other"

/**
 * Classify a product from its costing category + decoded variant/size.
 * Category text is the strongest signal available before human review.
 */
export function classifyProductType(
  category: string | null,
  variant: string | null,
  size: string | null,
): ProductType {
  const c = (category ?? "").toLowerCase()
  if (variant === "meal") return "meal"
  if (variant === "solo") return "solo"
  if (/make it a meal|meal upgrade|upgrade/.test(c)) return "meal_upgrade"
  if (/add[- ]?on|extra|topping|add ingredient/.test(c)) return "addon"
  if (/modifier|flavour|remove|option|crust|base|size|pizza name/.test(c)) return "modifier"
  if (/deal|box meal|bundle|offer|combo|platter/.test(c)) return "deal"
  if (/drink|shake|milkshake|mocktail|soft/.test(c)) return "drink"
  if (/side|fries|dip|sauce|garlic bread|salad/.test(c)) return "side"
  if (/dessert|sundae|ice cream|cake|cheesecake|pudding/.test(c)) return "side"
  // A sized pizza with no variant is a plain sellable product.
  if (size) return "solo"
  return "other"
}
