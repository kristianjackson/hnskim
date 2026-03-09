create extension if not exists pgcrypto with schema extensions;

create type public.hn_item_type as enum ('story', 'job', 'comment', 'poll', 'pollopt');
create type public.hn_feed_source as enum ('topstories', 'newstories', 'beststories');
create type public.article_fetch_status as enum (
  'pending',
  'succeeded',
  'http_error',
  'network_error',
  'timeout',
  'blocked',
  'non_html'
);
create type public.extraction_quality as enum ('good', 'partial', 'poor');
create type public.summary_confidence as enum ('high', 'medium', 'low');
create type public.summary_status as enum ('pending', 'succeeded', 'failed', 'refused');
create type public.job_type as enum (
  'ingest_topstories',
  'fetch_article',
  'extract_article',
  'summarize_article'
);
create type public.job_status as enum ('pending', 'running', 'succeeded', 'failed', 'cancelled');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint profiles_display_name_not_blank check (char_length(trim(display_name)) > 0)
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      split_part(coalesce(new.email, ''), '@', 1),
      'Reader'
    )
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create table public.hn_items (
  id bigint primary key,
  type public.hn_item_type not null default 'story',
  byline text,
  title text not null,
  url text,
  text_content text,
  score integer not null default 0,
  descendants integer not null default 0,
  hn_created_at timestamptz not null,
  source_domain text,
  feed_sources public.hn_feed_source[] not null default array['topstories'::public.hn_feed_source],
  topstories_rank integer,
  is_dead boolean not null default false,
  is_deleted boolean not null default false,
  raw_payload jsonb not null default '{}'::jsonb,
  discovered_at timestamptz not null default timezone('utc', now()),
  last_seen_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint hn_items_id_positive check (id > 0),
  constraint hn_items_title_not_blank check (char_length(trim(title)) > 0),
  constraint hn_items_score_nonnegative check (score >= 0),
  constraint hn_items_descendants_nonnegative check (descendants >= 0),
  constraint hn_items_topstories_rank_nonnegative check (
    topstories_rank is null or topstories_rank >= 0
  ),
  constraint hn_items_feed_sources_not_empty check (cardinality(feed_sources) > 0)
);

create table public.article_fetches (
  id uuid primary key default gen_random_uuid(),
  hn_item_id bigint not null references public.hn_items(id) on delete cascade,
  request_url text not null,
  final_url text,
  fetch_status public.article_fetch_status not null default 'pending',
  response_status integer,
  content_type text,
  content_language text,
  content_length_bytes integer,
  body_html text,
  body_sha256 text,
  http_headers jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint article_fetches_response_status_valid check (
    response_status is null or response_status between 100 and 599
  ),
  constraint article_fetches_content_length_nonnegative check (
    content_length_bytes is null or content_length_bytes >= 0
  )
);

create table public.article_extractions (
  id uuid primary key default gen_random_uuid(),
  hn_item_id bigint not null references public.hn_items(id) on delete cascade,
  article_fetch_id uuid not null unique references public.article_fetches(id) on delete cascade,
  extractor_name text not null default 'readability',
  extractor_version text,
  title text,
  byline text,
  site_name text,
  published_at timestamptz,
  excerpt text,
  content_text text not null default '',
  word_count integer not null default 0,
  content_sha256 text,
  extraction_quality public.extraction_quality not null default 'partial',
  risk_flags text[] not null default '{}'::text[],
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint article_extractions_word_count_nonnegative check (word_count >= 0)
);

create table public.article_summaries (
  id uuid primary key default gen_random_uuid(),
  hn_item_id bigint not null references public.hn_items(id) on delete cascade,
  article_extraction_id uuid not null references public.article_extractions(id) on delete cascade,
  summary_status public.summary_status not null default 'pending',
  summary_schema_version text not null default 'v1',
  model_name text not null,
  response_id text,
  prompt_version text,
  summary_bullets jsonb not null default '[]'::jsonb,
  why_it_matters text,
  topic_tags text[] not null default '{}'::text[],
  reading_time_minutes integer,
  summary_confidence public.summary_confidence,
  risk_flags text[] not null default '{}'::text[],
  extraction_quality public.extraction_quality,
  token_usage jsonb not null default '{}'::jsonb,
  response_metadata jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint article_summaries_bullets_is_array check (jsonb_typeof(summary_bullets) = 'array'),
  constraint article_summaries_reading_time_nonnegative check (
    reading_time_minutes is null or reading_time_minutes >= 0
  )
);

create table public.user_story_states (
  user_id uuid not null references auth.users(id) on delete cascade,
  hn_item_id bigint not null references public.hn_items(id) on delete cascade,
  saved_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, hn_item_id),
  constraint user_story_states_has_state check (
    saved_at is not null or dismissed_at is not null
  ),
  constraint user_story_states_not_both check (
    not (saved_at is not null and dismissed_at is not null)
  )
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  job_type public.job_type not null,
  status public.job_status not null default 'pending',
  hn_item_id bigint references public.hn_items(id) on delete cascade,
  article_fetch_id uuid references public.article_fetches(id) on delete cascade,
  article_extraction_id uuid references public.article_extractions(id) on delete cascade,
  dedupe_key text,
  payload jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  available_at timestamptz not null default timezone('utc', now()),
  lease_token uuid,
  leased_until timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  last_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint jobs_attempt_count_nonnegative check (attempt_count >= 0),
  constraint jobs_max_attempts_positive check (max_attempts > 0)
);

create or replace function public.claim_jobs(
  requested_types public.job_type[] default null,
  batch_size integer default 5,
  lease_seconds integer default 300
)
returns setof public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  lease_until timestamptz := timezone('utc', now()) + make_interval(secs => greatest(lease_seconds, 30));
begin
  update public.jobs
  set
    status = 'pending',
    lease_token = null,
    leased_until = null
  where status = 'running'
    and leased_until is not null
    and leased_until < timezone('utc', now());

  return query
  with candidate_jobs as (
    select j.id
    from public.jobs j
    where j.status = 'pending'
      and j.available_at <= timezone('utc', now())
      and (requested_types is null or j.job_type = any (requested_types))
    order by j.available_at asc, j.created_at asc
    limit greatest(batch_size, 1)
    for update skip locked
  ), updated as (
    update public.jobs j
    set
      status = 'running',
      attempt_count = j.attempt_count + 1,
      lease_token = gen_random_uuid(),
      leased_until = lease_until,
      started_at = coalesce(j.started_at, timezone('utc', now()))
    from candidate_jobs
    where j.id = candidate_jobs.id
    returning j.*
  )
  select * from updated;
end;
$$;

create index hn_items_topstories_idx
  on public.hn_items (topstories_rank asc nulls last, hn_created_at desc);
create index hn_items_last_seen_idx on public.hn_items (last_seen_at desc);
create index hn_items_source_domain_idx on public.hn_items (source_domain);
create index hn_items_feed_sources_idx on public.hn_items using gin (feed_sources);

create index article_fetches_hn_item_idx on public.article_fetches (hn_item_id, created_at desc);
create index article_fetches_status_idx on public.article_fetches (fetch_status, created_at desc);
create index article_fetches_body_sha_idx
  on public.article_fetches (body_sha256)
  where body_sha256 is not null;

create index article_extractions_hn_item_idx
  on public.article_extractions (hn_item_id, created_at desc);
create index article_extractions_quality_idx
  on public.article_extractions (extraction_quality, created_at desc);
create index article_extractions_hn_item_content_sha_idx
  on public.article_extractions (hn_item_id, content_sha256)
  where content_sha256 is not null;
create index article_extractions_content_sha_idx
  on public.article_extractions (content_sha256)
  where content_sha256 is not null;

create index article_summaries_hn_item_idx
  on public.article_summaries (hn_item_id, created_at desc);
create index article_summaries_success_idx
  on public.article_summaries (article_extraction_id, created_at desc)
  where summary_status = 'succeeded';
create unique index article_summaries_success_unique_idx
  on public.article_summaries (article_extraction_id, summary_schema_version)
  where summary_status = 'succeeded';

create index user_story_states_user_idx
  on public.user_story_states (user_id, updated_at desc);

create index jobs_queue_idx on public.jobs (status, available_at, created_at);
create index jobs_type_idx on public.jobs (job_type, status, available_at);
create unique index jobs_dedupe_active_idx
  on public.jobs (dedupe_key)
  where dedupe_key is not null and status in ('pending', 'running');

create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

create trigger set_hn_items_updated_at
before update on public.hn_items
for each row
execute function public.set_updated_at();

create trigger set_article_fetches_updated_at
before update on public.article_fetches
for each row
execute function public.set_updated_at();

create trigger set_article_extractions_updated_at
before update on public.article_extractions
for each row
execute function public.set_updated_at();

create trigger set_article_summaries_updated_at
before update on public.article_summaries
for each row
execute function public.set_updated_at();

create trigger set_user_story_states_updated_at
before update on public.user_story_states
for each row
execute function public.set_updated_at();

create trigger set_jobs_updated_at
before update on public.jobs
for each row
execute function public.set_updated_at();

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.hn_items enable row level security;
alter table public.article_fetches enable row level security;
alter table public.article_extractions enable row level security;
alter table public.article_summaries enable row level security;
alter table public.user_story_states enable row level security;
alter table public.jobs enable row level security;

create policy "users can read their own profile"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

create policy "users can insert their own profile"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

create policy "users can update their own profile"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "hn items are publicly readable"
on public.hn_items
for select
using (true);

create policy "successful summaries are publicly readable"
on public.article_summaries
for select
using (summary_status = 'succeeded');

create policy "users can read their own story state"
on public.user_story_states
for select
to authenticated
using (auth.uid() = user_id);

create policy "users can create their own story state"
on public.user_story_states
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "users can update their own story state"
on public.user_story_states
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "users can delete their own story state"
on public.user_story_states
for delete
to authenticated
using (auth.uid() = user_id);

revoke all on function public.claim_jobs(public.job_type[], integer, integer) from public;
revoke all on function public.claim_jobs(public.job_type[], integer, integer) from anon;
revoke all on function public.claim_jobs(public.job_type[], integer, integer) from authenticated;
