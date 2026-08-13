-- The original Google Sheet's Feedback tab had a "Use Up Ingredients" column
-- distinct from "Pantry Ingredients" (review_feedback rows populate both
-- separately) -- missed in the initial schema. Add it so historical
-- review_feedback rows can be migrated without losing that field.
alter table feedback add column use_up_ingredients text;
