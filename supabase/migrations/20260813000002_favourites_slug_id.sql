-- index.html matches "already saved" favourites by slugify(recipe name), the
-- same way household.json always used a slugified name as the favourite's id
-- (e.g. "soy-glazed-baked-chicken-thighs-rice-steamed-broccoli"). The initial
-- schema gave favourites a random uuid id instead, which silently breaks that
-- matching logic. Switch to a text id (the app computes and supplies the slug
-- itself), matching the original file shape.
alter table favourites alter column id drop default;
alter table favourites alter column id type text using id::text;
