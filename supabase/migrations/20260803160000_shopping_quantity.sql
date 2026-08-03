-- ============================================================================
-- 0030 · Wie viel, nicht nur was
-- ============================================================================
-- "Milch" on the Einkaufsliste has always meant one of them, and that was the
-- gap: you buy six eggs and two packs of butter, and the list can only say the
-- words. It matters twice over now that finishing a shop books the goods back
-- into the inventory — without a number, everything arrives home as a single
-- unit.
--
-- On the todo list the column is inert. It is one table with two lists (0024),
-- and a quantity is meaningless for "Fenster putzen" — so rather than a second
-- table or a nullable column nobody reads, it defaults to 1 and the to-do
-- screen never shows it.
--
-- numeric, not integer: the inventory has dealt in halves since 0025, and
-- "0,5 kg Hack" is a normal thing to write on a shopping list.
-- ============================================================================

alter table public.todos
  add column quantity numeric(12,3) not null default 1
    check (quantity > 0);

comment on column public.todos.quantity is
  'How many to buy. Only meaningful on the Einkaufsliste; to-dos leave it at 1.';
