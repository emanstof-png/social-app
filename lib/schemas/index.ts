/**
 * Zod schemas for every table in supabase/migrations.
 *
 * Each table exposes a `...Row` schema (what the database returns) and a
 * `...Insert` schema (what the application writes); tables the user edits also
 * expose `...Update`.
 */

export * from "./common";
export * from "./enums";
export * from "./profile";
export * from "./assessment";
export * from "./activity";
export * from "./community";
export * from "./event";
export * from "./evaluation";
export * from "./crm";
export * from "./llm";
export * from "./discovery";
export * from "./search";
