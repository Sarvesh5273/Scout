import { normalizeText } from "./urls";

/**
 * Small gazetteer so a seeker who asks for "United States" matches a posting in "Seattle, WA", and
 * "United Kingdom" matches "London". Only used for cheap pre-ranking; the AI match step makes the final call.
 */

const COUNTRY_ALIASES: Record<string, string[]> = {
  "united states": ["united states", "united states of america", "usa", "us", "u s", "u s a", "america"],
  "united kingdom": ["united kingdom", "uk", "u k", "england", "scotland", "wales", "great britain", "britain"],
  netherlands: ["netherlands", "the netherlands", "holland"],
  germany: ["germany", "deutschland"],
  switzerland: ["switzerland", "schweiz", "suisse"],
  "south korea": ["south korea", "korea", "republic of korea"],
  "united arab emirates": ["united arab emirates", "uae"],
  "czech republic": ["czech republic", "czechia"],
};

const CITY_COUNTRY: Record<string, string> = {
  "new york": "united states", nyc: "united states", "san francisco": "united states", seattle: "united states",
  boston: "united states", austin: "united states", chicago: "united states", "los angeles": "united states",
  "mountain view": "united states", "palo alto": "united states", "menlo park": "united states",
  sunnyvale: "united states", "san jose": "united states", redmond: "united states", bellevue: "united states",
  pittsburgh: "united states", atlanta: "united states", denver: "united states", "san diego": "united states",
  "washington dc": "united states", philadelphia: "united states", "salt lake city": "united states",
  "silicon valley": "united states", "bay area": "united states", "south san francisco": "united states",
  london: "united kingdom", manchester: "united kingdom", edinburgh: "united kingdom", oxford: "united kingdom",
  bristol: "united kingdom", belfast: "united kingdom", glasgow: "united kingdom",
  amsterdam: "netherlands", rotterdam: "netherlands", eindhoven: "netherlands", delft: "netherlands",
  utrecht: "netherlands", "the hague": "netherlands", leiden: "netherlands",
  berlin: "germany", munich: "germany", munchen: "germany", hamburg: "germany", frankfurt: "germany",
  stuttgart: "germany", cologne: "germany", aachen: "germany", heidelberg: "germany", karlsruhe: "germany",
  tubingen: "germany", dresden: "germany", bonn: "germany", saarbrucken: "germany",
  toronto: "canada", vancouver: "canada", montreal: "canada", waterloo: "canada", ottawa: "canada",
  calgary: "canada", edmonton: "canada",
  tokyo: "japan", osaka: "japan", kyoto: "japan", tsukuba: "japan",
  zurich: "switzerland", geneva: "switzerland", lausanne: "switzerland", basel: "switzerland", bern: "switzerland",
  paris: "france", lyon: "france", grenoble: "france", saclay: "france",
  dublin: "ireland", bengaluru: "india", bangalore: "india", hyderabad: "india", pune: "india", mumbai: "india",
  delhi: "india", gurgaon: "india", gurugram: "india", noida: "india", chennai: "india",
  sydney: "australia", melbourne: "australia", brisbane: "australia", stockholm: "sweden", copenhagen: "denmark",
  oslo: "norway", helsinki: "finland", madrid: "spain", barcelona: "spain", milan: "italy", rome: "italy",
  lisbon: "portugal", warsaw: "poland", prague: "czech republic", vienna: "austria", brussels: "belgium",
  "tel aviv": "israel", seoul: "south korea", beijing: "china", shanghai: "china", shenzhen: "china",
  taipei: "taiwan", dubai: "united arab emirates", "abu dhabi": "united arab emirates", bucharest: "romania",
  "sao paulo": "brazil", "mexico city": "mexico", singapore: "singapore", "hong kong": "hong kong",
};

const US_STATE_CODES = new Set(
  "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(
    " ",
  ),
);
const US_STATES = [
  "california", "texas", "massachusetts", "new jersey", "illinois", "pennsylvania", "virginia",
  "colorado", "michigan", "ohio", "north carolina", "oregon", "maryland", "minnesota", "arizona", "utah",
];

const hasWord = (haystack: string, needle: string) => new RegExp(`(^| )${needle}( |$)`).test(haystack);

function countryOf(place: string): string | null {
  for (const [country, aliases] of Object.entries(COUNTRY_ALIASES)) {
    if (aliases.includes(place)) return country;
  }
  return null;
}

/** True if `location` (from a posting) is inside the place the seeker asked for. */
export function placeMatches(wanted: string, location: string): boolean {
  const want = normalizeText(wanted);
  const loc = normalizeText(location);
  if (!want || !loc) return false;
  if (hasWord(loc, want)) return true;

  const country = countryOf(want) ?? (Object.values(CITY_COUNTRY).includes(want) ? want : null);
  if (!country) return false;
  const aliases = COUNTRY_ALIASES[country] ?? [country];
  if (aliases.some((a) => hasWord(loc, a))) return true;
  for (const [city, cityCountry] of Object.entries(CITY_COUNTRY)) {
    if (cityCountry === country && hasWord(loc, city)) return true;
  }
  if (country === "united states") {
    const codes = [...location.matchAll(/,\s*([A-Z]{2})\b/g)].map((m) => m[1] ?? "");
    if (codes.some((c) => US_STATE_CODES.has(c))) return true;
    if (US_STATES.some((s) => hasWord(loc, s))) return true;
  }
  return false;
}
