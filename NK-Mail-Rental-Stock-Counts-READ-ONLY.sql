-- Run in Supabase SQL Editor before enabling stock counts on the site.
CREATE OR REPLACE FUNCTION public.nk_mail_rental_stock_counts()
RETURNS TABLE(service text, available_mails bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH candidate AS (
    SELECT DISTINCT lower(btrim(public.nk_extract_icloud_email(a.account_details))) AS email
    FROM public.mmo_accounts a
    WHERE a.platform = 'iCloud' AND a.status = 'Đang bán'
  )
  SELECT s.service, count(c.email)::bigint
  FROM (VALUES ('shopee'::text), ('facebook'::text), ('tiktok'::text)) s(service)
  LEFT JOIN candidate c ON c.email IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.mail_rental_service_usage u WHERE u.email=c.email AND u.service=s.service)
    AND NOT EXISTS (SELECT 1 FROM public.mail_rentals r WHERE lower(btrim(r.email))=c.email AND r.status='active')
  GROUP BY s.service;
$$;
REVOKE ALL ON FUNCTION public.nk_mail_rental_stock_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nk_mail_rental_stock_counts() TO authenticated, service_role;
