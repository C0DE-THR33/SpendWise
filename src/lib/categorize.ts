// Deterministic merchant-name categorization: the "rules first" half of
// CONVENTIONS.md #1's "rules first, LLM for ambiguous cases".
//
// Pure and dependency-free on purpose (#2) — no database, no network, no
// Prisma types — so it can be verified with a plain script (#8). The
// caller resolves the returned CategoryIcon to an actual Category row.
//
// THREE THINGS THIS GETS RIGHT THAT A NAIVE VERSION WOULD NOT:
//
// 1. Word boundaries, not substrings. `"UBER"` inside a narration is a
//    ride; `"OLA"` as a substring also appears in CHOCOLATE, SOLAR,
//    GORILLA and TESLA. Substring matching on short merchant names is
//    actively wrong, and the failure is silent — a chocolate purchase
//    quietly filed under Transport. Everything here matches whole words.
//
// 2. Brands beat generic keywords. This is a TIER, not a length
//    comparison. "Metro Card Recharge" is a transport top-up, but the
//    generic keyword RECHARGE (bills) is a longer string than the brand
//    METRO — so sorting by length alone silently filed it under Bills.
//    Brands are checked first as a class; only if none match does the
//    generic keyword pass run.
//
// 3. Within a tier, longer phrases win. "AMAZON PRIME" (entertainment)
//    must beat "AMAZON" (shopping), and it does without any hand-ordering
//    of the table below.

import type { CategoryIcon } from "./categories";

type Tier = "brand" | "keyword";

export interface CategoryRule {
  phrase: string;
  icon: CategoryIcon;
  tier: Tier;
}

// Bank narrations are noisy — "UPI/DR/412345678/SWIGGY/YESB/swiggy@ybl",
// "POS 4321XXXXXXXX1234 UBER INDIA SYSTEMS", "ACH DR- NETFLIX". Reducing
// to uppercase words separated by single spaces means one matching rule
// instead of one per punctuation style.
export function normalizeNarration(raw: string): string {
  return ` ${raw.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim()} `;
}

// --- Tier 1: named merchants ------------------------------------------
// India-first, since the app is INR and Setu is an Indian AA.
const BRANDS: Record<CategoryIcon, string[]> = {
  transport: [
    "UBER", "OLA", "OLA CABS", "RAPIDO", "NAMMA YATRI", "BLUSMART", "MERU",
    "IRCTC", "INDIAN RAILWAY", "REDBUS", "ABHIBUS", "APSRTC", "MSRTC", "KSRTC",
    "INDIGO", "SPICEJET", "VISTARA", "AIR INDIA", "AKASA AIR", "GOAIR",
    "METRO", "DMRC", "DELHI METRO", "BMTC", "BMRCL", "NAMMA METRO",
    "FASTAG", "NHAI",
    "HPCL", "BPCL", "IOCL", "INDIAN OIL", "BHARAT PETROLEUM",
    "HINDUSTAN PETROLEUM", "SHELL", "NAYARA", "JIO BP",
  ],
  food: [
    "SWIGGY", "ZOMATO", "EATSURE", "FAASOS", "BEHROUZ", "OVENSTORY", "BOX8",
    "DOMINOS", "PIZZA HUT", "MCDONALDS", "BURGER KING", "SUBWAY", "WOW MOMO",
    "STARBUCKS", "CAFE COFFEE DAY", "BARISTA", "CHAAYOS", "CHAI POINT",
    "THIRD WAVE", "BLUE TOKAI", "DUNKIN", "BASKIN ROBBINS", "NATURALS",
    "HALDIRAM", "BIKANERVALA", "SAGAR RATNA",
    "BLINKIT", "ZEPTO", "BIGBASKET", "INSTAMART", "GROFERS", "DUNZO",
    "LICIOUS", "COUNTRY DELIGHT", "MILKBASKET", "DMART", "RELIANCE FRESH",
    "SPENCERS", "NATURE BASKET",
  ],
  shopping: [
    "AMAZON", "FLIPKART", "MYNTRA", "AJIO", "NYKAA", "MEESHO", "SNAPDEAL",
    "TATA CLIQ", "DECATHLON", "IKEA", "CROMA", "RELIANCE DIGITAL",
    "VIJAY SALES", "LIFESTYLE", "SHOPPERS STOP", "PANTALOONS", "WESTSIDE",
    "MAX FASHION", "ZARA", "UNIQLO", "LEVIS", "PUMA", "ADIDAS", "NIKE",
    "FIRSTCRY", "LENSKART", "TITAN", "TANISHQ", "CARATLANE",
    "BOAT LIFESTYLE", "APPLE STORE", "SAMSUNG", "ONEPLUS",
  ],
  bills: [
    "AIRTEL", "JIO", "JIO FIBER", "RELIANCE JIO", "VODAFONE", "VODAFONE IDEA",
    "BSNL", "MTNL", "ACT FIBERNET", "HATHWAY", "EXCITEL", "TIKONA",
    "TATA PLAY", "DISH TV", "SUN DIRECT",
    "BESCOM", "MSEDCL", "TNEB", "TSSPDCL", "APSPDCL", "BSES", "TATA POWER",
    "ADANI ELECTRICITY", "TORRENT POWER",
    "INDANE", "HP GAS", "BHARAT GAS", "LIC", "POLICYBAZAAR",
  ],
  entertainment: [
    "NETFLIX", "AMAZON PRIME", "PRIME VIDEO", "HOTSTAR", "JIOHOTSTAR",
    "JIOCINEMA", "SONYLIV", "ZEE5", "VOOT", "MUBI",
    "SPOTIFY", "APPLE MUSIC", "YOUTUBE PREMIUM", "YOUTUBE", "GAANA", "WYNK",
    "AUDIBLE", "KINDLE", "BOOKMYSHOW", "PVR", "INOX", "CINEPOLIS",
    "STEAM GAMES", "PLAYSTATION", "XBOX", "NINTENDO", "DREAM11",
  ],
  other: [],
};

// --- Tier 2: generic words --------------------------------------------
// Only consulted when no brand matched. These are the words that describe
// a *kind* of spend rather than a seller, and they're the ones most likely
// to appear incidentally in someone else's narration — which is exactly
// why they must never outrank a real merchant name.
// Everyday words, including the ones people actually type into the cash
// sheet. That entry point is free text rather than a bank's merchant
// field, so this tier carries far more weight there than it does for
// synced rows — "Auto rickshaw" and "chai" are the realistic inputs, and
// both were unmatched until a manual entry exposed it.
//
// Plurals are listed explicitly. Matching is on whole tokens, so GROCERIES
// is simply a different word from GROCERY; stripping a trailing S
// automatically would turn BUS into BU.
const KEYWORDS: Record<CategoryIcon, string[]> = {
  transport: [
    "AUTO", "RICKSHAW", "AUTO RICKSHAW", "TUKTUK", "CAB", "TAXI", "BUS", "TRAIN",
    "PETROL", "DIESEL", "PETROL PUMP", "FUEL", "FUEL STATION",
    "PARKING", "TOLL", "TOLL PLAZA", "FARE", "TICKET", "TICKETS",
  ],
  food: [
    "RESTAURANT", "DHABA", "BAKERY", "CAFE", "CANTEEN", "MESS", "KITCHEN",
    "FOODS", "DINER", "BIRYANI", "CHAI", "TEA", "COFFEE", "JUICE",
    "SNACKS", "TIFFIN", "LUNCH", "DINNER", "BREAKFAST",
    "MILK", "VEGETABLES", "SABZI", "FRUITS", "SUPERMARKET", "KIRANA",
    "GROCERY", "GROCERIES",
  ],
  shopping: ["STORE", "MART", "RETAIL", "BOUTIQUE", "CLOTHES", "SALON", "BARBER"],
  bills: [
    "ELECTRICITY", "POWER BILL", "GAS BILL", "WATER BILL", "MUNICIPAL",
    "BROADBAND", "FIBERNET", "INSURANCE", "PREMIUM", "RENT", "MAINTENANCE",
    "SOCIETY", "RECHARGE", "POSTPAID", "PREPAID",
  ],
  // TICKET defaults to transport above, since a bus/train ticket is the
  // commoner cash spend — so the entertainment senses are spelled out as
  // longer phrases, which win within the tier. Without these, "Movie
  // ticket" (singular) lands in Transport; it only escaped that in testing
  // because the plural "tickets" happened not to match "TICKET".
  entertainment: [
    "CINEMA", "MULTIPLEX", "MOVIE", "CONCERT", "GAME",
    "MOVIE TICKET", "MOVIE TICKETS", "CONCERT TICKET", "CONCERT TICKETS",
  ],
  other: [],
};

function build(table: Record<CategoryIcon, string[]>, tier: Tier): CategoryRule[] {
  return Object.entries(table)
    .flatMap(([icon, list]) =>
      list.map((phrase) => ({
        phrase: normalizeNarration(phrase).trim(),
        icon: icon as CategoryIcon,
        tier,
      })),
    )
    // Longest phrase first within the tier, so "AMAZON PRIME" is tested
    // before "AMAZON".
    .sort((a, b) => b.phrase.length - a.phrase.length);
}

const BRAND_RULES = build(BRANDS, "brand");
const KEYWORD_RULES = build(KEYWORDS, "keyword");

export interface RuleMatch {
  icon: CategoryIcon;
  /** Which phrase fired — kept so a wrong guess is debuggable, not magic. */
  matched: string;
  tier: Tier;
}

function findIn(haystack: string, rules: CategoryRule[]): RuleMatch | null {
  for (const rule of rules) {
    if (haystack.includes(` ${rule.phrase} `)) {
      return { icon: rule.icon, matched: rule.phrase, tier: rule.tier };
    }
  }
  return null;
}

/**
 * Categorizes a transaction from its merchant name and narration.
 *
 * Returns null when nothing matches rather than guessing — an unmatched
 * transaction stays visibly Uncategorized, which is a real state the UI
 * renders properly (CONVENTIONS.md #4), and is the hand-off point for the
 * LLM pass described in #1. A wrong automatic category is worse than an
 * honest blank one: the user can't tell the difference without checking
 * every row, and the budget silently misreports until they do.
 *
 * Field order matters as much as tier order. merchantName is the cleaner
 * signal, so a brand there beats anything in the free-text narration
 * ("...REF NO AMAZON PAY..." must not override a known merchant).
 */
export function categorizeByRules(input: {
  merchantName?: string | null;
  description?: string | null;
}): RuleMatch | null {
  const fields = [input.merchantName, input.description]
    .filter((f): f is string => Boolean(f))
    .map(normalizeNarration);

  // Every field's brands, then every field's keywords.
  for (const haystack of fields) {
    const brand = findIn(haystack, BRAND_RULES);
    if (brand) return brand;
  }
  for (const haystack of fields) {
    const keyword = findIn(haystack, KEYWORD_RULES);
    if (keyword) return keyword;
  }
  return null;
}

// A NOTE ON THE SIX-CATEGORY CEILING
//
// Groceries, travel and health all get squeezed into an existing bucket
// here because the shipped set is exactly six (lib/categories.ts). That's
// a real modelling limit, not an oversight: Blinkit is filed under Food, a
// flight under Transport. If category count ever grows, these rules are
// the first place that should change — and the sixth-category question
// still open in CONVENTIONS.md #3 (income vs other) is the same
// conversation.
