# Crisis-Sense Staging Checklist

## 1. Environment setup
Set these variables before running:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (server only)
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `INTERNAL_DASHBOARD_API_KEY`
- `SMOKE_USER_ID`
- `ANALYSIS_MODEL` and any AI provider keys currently required by your backend

## 2. Build
```bash
npm run build
```
Expected: build succeeds without TypeScript or bundling errors.

## 3. Health check
```bash
curl http://localhost:5000/health
curl http://localhost:5000/api/health
```
Expected: both return JSON with `"status":"ok"`.

## 4. Report creation check
```bash
curl -X POST http://localhost:5000/api/reports \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "citizen-anon",
    "category": "صحة",
    "subProblem": "نقص أدوية أساسية",
    "area": "غزة المدينة",
    "specificLocation": null,
    "title": "صحة - نقص أدوية أساسية",
    "content": "Category: صحة\nIssue: نقص أدوية أساسية\nArea: غزة المدينة\nDetails: لا توجد أمثلة إضافية"
  }'
```
Expected: `201` response with report id.

## 5. Smoke test
```bash
npm run test:smoke
```
Expected: `PASS` and a created report id.

## 6. Frontend password recovery smoke (manual)
Single deterministic scenario (frontend only):
1. In Supabase Dashboard, trigger a password recovery email for an existing admin-created user.
2. Open the recovery link in a fresh/private browser window while the app is running at `http://localhost:5000`.
3. Confirm the link opens `/reset-password` directly (not `/`) and stays there.
4. Enter a valid new password and matching confirmation, then submit.
5. Confirm success message is shown on the reset page.
6. Go to `/login` and sign in with the new password to confirm normal auth still works.

Pass criteria:
1. Password recovery uses `/reset-password` as a direct-entry page.
2. No root-level redirect guards or auth interception are required.
3. Normal visits to `/` and regular signed-in sessions remain unaffected.

## Dev-only Supabase RLS helper
```sql
-- DEV ONLY: do not keep this broad policy in production
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_public_insert_for_dev"
ON public.reports
FOR INSERT
USING (true)
WITH CHECK (true);
```
Production note: tighten policies to authenticated users/roles and keep service role usage only on trusted server paths.

## Key rotation note
1. Create a new Supabase service role key and anon key in project settings.
2. Update runtime env values (`SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_ANON_KEY`) in all environments.
3. Restart API, workers, and frontend deployments.
4. Revoke old keys after verification passes.
