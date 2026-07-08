-- ==========================================================================
-- Roomemates Database Schema Setup
-- Run this in your Supabase SQL Editor (https://supabase.com/dashboard/project/kkqljmupclhzrtqdqeus/sql/new)
-- ==========================================================================

-- Enable extensions if needed
create extension if not exists "uuid-ossp";

-- 1. Create Houses Table
create table public.houses (
    id uuid default gen_random_uuid() primary key,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    name text not null,
    invite_code text not null unique
);

-- 2. Create Profiles Table (extends auth.users)
create table public.profiles (
    id uuid references auth.users on delete cascade primary key,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    name text not null,
    avatar_url text,
    house_id uuid references public.houses(id) on delete set null
);

-- 3. Create Expenses Table
create table public.expenses (
    id uuid default gen_random_uuid() primary key,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    house_id uuid references public.houses(id) on delete cascade not null,
    payer_id uuid references public.profiles(id) on delete cascade not null,
    description text not null,
    amount numeric not null check (amount > 0),
    split_details jsonb not null -- Detailed split info, e.g., [{"user_id": "...", "amount": 10}, ...]
);

-- 4. Create Chores Table
create table public.chores (
    id uuid default gen_random_uuid() primary key,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    house_id uuid references public.houses(id) on delete cascade not null,
    name text not null,
    description text,
    assigned_to uuid references public.profiles(id) on delete set null,
    frequency text default 'one-off' not null, -- 'daily', 'weekly', 'one-off'
    due_date timestamp with time zone,
    last_completed_at timestamp with time zone,
    last_completed_by uuid references public.profiles(id) on delete set null
);

-- 5. Create Shopping Items Table
create table public.shopping_items (
    id uuid default gen_random_uuid() primary key,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    house_id uuid references public.houses(id) on delete cascade not null,
    name text not null,
    quantity text default '1' not null,
    added_by uuid references public.profiles(id) on delete cascade not null,
    is_purchased boolean default false not null,
    purchased_at timestamp with time zone,
    purchased_by uuid references public.profiles(id) on delete set null
);

-- Enable Row Level Security (RLS) on all tables
alter table public.houses enable row level security;
alter table public.profiles enable row level security;
alter table public.expenses enable row level security;
alter table public.chores enable row level security;
alter table public.shopping_items enable row level security;

-- Setup RLS Policies (Allow access to authenticated users)
-- In a production environment, you would restrict queries to members sharing the same house_id.
-- For development simplicity, we allow all authenticated users to read and write.

create policy "Allow all authenticated users access to houses"
    on public.houses for all to authenticated using (true) with check (true);

create policy "Allow all authenticated users access to profiles"
    on public.profiles for all to authenticated using (true) with check (true);

create policy "Allow all authenticated users access to expenses"
    on public.expenses for all to authenticated using (true) with check (true);

create policy "Allow all authenticated users access to chores"
    on public.chores for all to authenticated using (true) with check (true);

create policy "Allow all authenticated users access to shopping_items"
    on public.shopping_items for all to authenticated using (true) with check (true);

-- 6. Trigger to automatically sync profiles with auth.users
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, avatar_url, house_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', 'Roommate'),
    coalesce(new.raw_user_meta_data->>'avatar_url', ''),
    null
  );
  return new;
end;
$$ language plpgsql security definer;

-- Drop trigger if exists
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ==========================================================================
-- Chores-Only Feature Migrations
-- ==========================================================================

-- 1. Alter Chores Table to support rotations
ALTER TABLE public.chores ADD COLUMN IF NOT EXISTS rotation_type text DEFAULT 'rotating' NOT NULL;
ALTER TABLE public.chores ADD COLUMN IF NOT EXISTS rotation_order jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.chores ADD COLUMN IF NOT EXISTS last_rotated_at timestamp with time zone;

-- 2. Create Chore History Table
CREATE TABLE IF NOT EXISTS public.chore_history (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    house_id uuid REFERENCES public.houses(id) ON DELETE CASCADE NOT NULL,
    chore_id uuid REFERENCES public.chores(id) ON DELETE CASCADE NOT NULL,
    chore_name text NOT NULL,
    completed_by uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    completed_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    action_type text DEFAULT 'complete' NOT NULL -- 'complete', 'skip', 'swap'
);

-- 3. Create Chore Notifications Table
CREATE TABLE IF NOT EXISTS public.chore_notifications (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    house_id uuid REFERENCES public.houses(id) ON DELETE CASCADE NOT NULL,
    message text NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    profile_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL
);

-- 4. Enable RLS and add Policies
ALTER TABLE public.chore_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chore_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all authenticated users access to chore_history"
    ON public.chore_history FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow all authenticated users access to chore_notifications"
    ON public.chore_notifications FOR ALL TO authenticated USING (true) WITH CHECK (true);
