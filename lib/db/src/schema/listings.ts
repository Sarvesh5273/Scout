import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { huntsTable } from "./hunts";

export type ListingKindValue = "job" | "program";
export type WorkModeValue = "onsite" | "hybrid" | "remote" | "unknown";
export type ListingSeniorityValue = "internship" | "new_grad" | "entry_level" | "experienced" | "unknown";
export type VisaStatusValue = "sponsors" | "not_sponsored" | "citizens_only" | "unknown";
export type FundingLevelValue = "fully_funded" | "paid" | "unpaid" | "unknown";
export type ListingStatusValue = "open" | "closed" | "unverified";
export type FoundViaValue = "search" | "fetch" | "agent";

export interface VisaInfoData {
  status: VisaStatusValue;
  note: string | null;
}

export interface FundingInfoData {
  level: FundingLevelValue;
  stipend: boolean | null;
  travel: boolean | null;
  housing: boolean | null;
  note: string | null;
}

/** One real opening, shared across hunts and deduplicated by canonical URL (and org + title + location). */
export const listingsTable = pgTable(
  "listings",
  {
    id: serial("id").primaryKey(),
    canonicalUrl: text("canonical_url").notNull().unique(),
    dedupeKey: text("dedupe_key").notNull(),
    title: text("title").notNull(),
    organization: text("organization").notNull(),
    kind: text("kind").$type<ListingKindValue>().notNull(),
    locations: jsonb("locations").$type<string[]>().notNull(),
    workMode: text("work_mode").$type<WorkModeValue>().notNull(),
    seniority: text("seniority").$type<ListingSeniorityValue>().notNull(),
    employmentType: text("employment_type"),
    applyUrl: text("apply_url").notNull(),
    sourceUrl: text("source_url").notNull(),
    sourceLabel: text("source_label").notNull(),
    foundVia: text("found_via").$type<FoundViaValue>().notNull(),
    postedAt: date("posted_at", { mode: "string" }),
    deadline: date("deadline", { mode: "string" }),
    visa: jsonb("visa").$type<VisaInfoData>().notNull(),
    funding: jsonb("funding").$type<FundingInfoData>().notNull(),
    eligibility: text("eligibility"),
    summary: text("summary"),
    status: text("status").$type<ListingStatusValue>().notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    /** Last time Scout read the posting itself (not just saw it in a search result). */
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("listings_dedupe_key_idx").on(t.dedupeKey)],
);

/** A listing as matched to one hunt: its score for that hunt plus the user's save/hide flags. */
export const huntListingsTable = pgTable(
  "hunt_listings",
  {
    huntId: integer("hunt_id")
      .notNull()
      .references(() => huntsTable.id, { onDelete: "cascade" }),
    listingId: integer("listing_id")
      .notNull()
      .references(() => listingsTable.id, { onDelete: "cascade" }),
    score: integer("score").notNull(),
    reasons: jsonb("reasons").$type<string[]>().notNull(),
    firstSeenRunId: integer("first_seen_run_id"),
    lastSeenRunId: integer("last_seen_run_id"),
    saved: boolean("saved").notNull().default(false),
    hidden: boolean("hidden").notNull().default(false),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.huntId, t.listingId] })],
);

export type SourceKindValue = "careers_page" | "job_board" | "program_page" | "aggregator" | "posting";
export type SourceStatusValue = "ok" | "empty" | "blocked" | "failed";

/** Every page Scout checked for a hunt, with how it was read and what came of it. */
export const sourcesTable = pgTable(
  "sources",
  {
    id: serial("id").primaryKey(),
    huntId: integer("hunt_id")
      .notNull()
      .references(() => huntsTable.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    label: text("label").notNull(),
    kind: text("kind").$type<SourceKindValue>().notNull(),
    readMethod: text("read_method").$type<"fetch" | "agent">().notNull(),
    status: text("status").$type<SourceStatusValue>().notNull(),
    listingsFound: integer("listings_found").notNull().default(0),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    note: text("note"),
  },
  (t) => [uniqueIndex("sources_hunt_url_idx").on(t.huntId, t.url)],
);

export type Listing = typeof listingsTable.$inferSelect;
export type InsertListing = typeof listingsTable.$inferInsert;
export type HuntListing = typeof huntListingsTable.$inferSelect;
export type Source = typeof sourcesTable.$inferSelect;
