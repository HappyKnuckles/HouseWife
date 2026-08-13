-- ============================================================================
-- 0031 · Belege ohne OCR
-- ============================================================================
-- Receipt OCR is gone. Not because it did not work — a provider read a receipt
-- correctly — but because nothing downstream ever needed it. The parsed lines
-- were written to ocr_parsed and read by exactly one caption saying how many
-- there were; no screen ever turned them into Posten, and the whole point of
-- photographing a Kassenbon turned out to be *looking at it later*, which is
-- a feature the photo already provides on its own.
--
-- So what is being dropped is a set of columns that were only ever written to.
-- Nothing reads them, nothing derives from them, and no view or RPC touches
-- them: `receipts` keeps everything that makes the photo work (storage_path,
-- mime_type, size, dimensions, uploader) and loses only the parsing sidecar.
--
-- expense_items.source stays, narrowed. It still records where a line came
-- from and apply_expense_split() still writes it — but 'ocr' is no longer one
-- of the answers, so the CHECK is tightened to the one value that remains.
-- The UPDATE ahead of it is not defensive theatre: a constraint that existing
-- rows violate fails the migration, and the value was reachable through the
-- RPC's `source` passthrough even though the app never sent it.
-- ============================================================================

drop index if exists public.receipts_ocr_status_idx;

alter table public.receipts
  drop column if exists ocr_status,
  drop column if exists ocr_provider,
  drop column if exists ocr_raw,
  drop column if exists ocr_parsed,
  drop column if exists ocr_error,
  drop column if exists ocr_completed_at;

update public.expense_items set source = 'manual' where source <> 'manual';

alter table public.expense_items drop constraint if exists expense_items_source_check;
alter table public.expense_items
  add constraint expense_items_source_check check (source in ('manual'));

comment on table public.receipts is
  'Photos of a till roll, attached to an expense. Kept so "what was in that 87 € shop" is answerable; nothing parses them.';
