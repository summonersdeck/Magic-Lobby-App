import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const gamesTable = pgTable("games", {
  id: text("id").primaryKey(),
  code: text("code").unique().notNull(),
  state: jsonb("state").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const gameTokensTable = pgTable("game_tokens", {
  token: text("token").primaryKey(),
  gameId: text("game_id")
    .notNull()
    .references(() => gamesTable.id, { onDelete: "cascade" }),
  playerId: text("player_id").notNull(),
});
