import { index, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/** Mirrors the API's HuntPreferences. The API server validates with the generated Zod schema before writing. */
export interface HuntPreferencesData {
  roles: string[];
  keywords: string[];
  excludeKeywords: string[];
  locations: string[];
  remoteOk: boolean;
  seniority: Array<"internship" | "new_grad" | "entry_level" | "experienced">;
  opportunityTypes: Array<"company_roles" | "research_programs">;
  needsVisaSponsorship: boolean;
  citizenship: string | null;
  funding: "any" | "paid" | "fully_funded";
  companies: string[];
}

export const huntsTable = pgTable(
  "hunts",
  {
    id: serial("id").primaryKey(),
    /** Anonymous browser identity that owns the hunt; null for showcase hunts. */
    clientId: text("client_id"),
    /** Stable key for Scout-owned showcase hunts (seeded on startup); null for user hunts. */
    showcaseKey: text("showcase_key").unique(),
    name: text("name").notNull(),
    preferences: jsonb("preferences").$type<HuntPreferencesData>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    nextRefreshAt: timestamp("next_refresh_at", { withTimezone: true }),
    /** Scheduled refreshes skip user hunts nobody has opened recently. */
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
  },
  (t) => [index("hunts_client_id_idx").on(t.clientId)],
);

export type Hunt = typeof huntsTable.$inferSelect;
export type InsertHunt = typeof huntsTable.$inferInsert;
