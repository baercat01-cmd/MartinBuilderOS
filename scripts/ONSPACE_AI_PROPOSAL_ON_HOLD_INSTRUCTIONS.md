# Instructions for OnSpace AI: Enable "Put proposal on hold"

The app shows: **"On-hold is not set up on this database yet. Run the 'add quotes.on_hold' migration SQL on this Supabase project, then reload."**

Verified cause: the `quotes` table is missing the `on_hold` column on the connected database
(REST returns `42703: column quotes.on_hold does not exist`). Add the column and reload the
API schema.

---

**Copy everything below this line and paste into OnSpace AI:**

---

I need to enable the "Put proposal on hold" feature in my app. It uses a Supabase project
connected to OnSpace. Please run the following in my **Supabase project** (SQL Editor, or
however SQL runs on my connected Supabase):

1. **Add the column** (if missing):
```sql
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS on_hold boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.quotes.on_hold IS 'When true, quote is paused for follow-up; status column unchanged.';
```

2. **Reload the API schema** so the REST API sees the new column:
```sql
NOTIFY pgrst, 'reload schema';
```

That's it — no RPCs are needed; the app reads and writes `quotes.on_hold` directly. After
this runs, I will reload my app and the **Put proposal on hold** / **Resume proposal** menu
item will move proposals into the On Hold column.
