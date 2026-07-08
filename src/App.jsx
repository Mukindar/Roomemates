import React, { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, clearSupabaseClient } from './supabaseClient';
import AuthPage from './components/AuthPage';
import HouseSetup from './components/HouseSetup';
import Layout from './components/Layout';
import Dashboard from './components/Dashboard';
import Expenses from './components/Expenses';
import Chores from './components/Chores';
import Shopping from './components/Shopping';
import { Activity } from 'lucide-react';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function MainAppShell() {
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [authLoading, setAuthLoading] = useState(true);
  const qc = useQueryClient();

  // 1. Monitor auth changes
  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return;
    }

    // Get current session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });

    // Listen for auth events
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (!session) {
        qc.clear(); // Clean up TanStack Query cache on sign out
      }
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, [qc]);

  // Try to re-trigger auth state check when user configures Supabase in client
  const triggerAuthCheck = () => {
    if (supabase) {
      setAuthLoading(true);
      supabase.auth.getSession().then(({ data: { session } }) => {
        setUser(session?.user ?? null);
        setAuthLoading(false);
      });
    }
  };

  // 2. Fetch profile details
  const { data: profile, isLoading: isProfileLoading, refetch: refetchProfile } = useQuery({
    queryKey: ['profile', user?.id],
    queryFn: async () => {
      if (!user) return null;

      // Attempt to retrieve current profile
      const { data, error } = await supabase
        .from('profiles')
        .select()
        .eq('id', user.id)
        .maybeSingle();

      if (error) throw error;
      if (data) return data;

      // Auto-provision profile row if not found (signed up prior to DB triggers)
      const { data: newProfile, error: insertErr } = await supabase
        .from('profiles')
        .insert([{
          id: user.id,
          name: user.user_metadata?.name || 'Roommate',
          avatar_url: user.user_metadata?.avatar_url || '',
          house_id: null
        }])
        .select()
        .single();

      if (insertErr) throw insertErr;
      return newProfile;
    },
    enabled: !!user && !!supabase,
  });

  const houseId = profile?.house_id;

  // 3. Fetch house details
  const { data: house, isLoading: isHouseLoading } = useQuery({
    queryKey: ['house', houseId],
    queryFn: async () => {
      if (!houseId) return null;
      const { data, error } = await supabase
        .from('houses')
        .select()
        .eq('id', houseId)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!houseId && !!supabase,
  });

  // 4. Fetch household members
  const { data: houseMembers = [], isLoading: isMembersLoading } = useQuery({
    queryKey: ['houseMembers', houseId],
    queryFn: async () => {
      if (!houseId) return [];
      const { data, error } = await supabase
        .from('profiles')
        .select()
        .eq('house_id', houseId);

      if (error) throw error;
      return data;
    },
    enabled: !!houseId && !!supabase,
  });

  // 5. Fetch expenses
  const { data: expenses = [], isLoading: isExpensesLoading } = useQuery({
    queryKey: ['expenses', houseId],
    queryFn: async () => {
      if (!houseId) return [];
      const { data, error } = await supabase
        .from('expenses')
        .select()
        .eq('house_id', houseId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!houseId && !!supabase,
  });

  // 6. Fetch chores
  const { data: chores = [], isLoading: isChoresLoading } = useQuery({
    queryKey: ['chores', houseId],
    queryFn: async () => {
      if (!houseId) return [];
      const { data, error } = await supabase
        .from('chores')
        .select()
        .eq('house_id', houseId)
        .order('due_date', { ascending: true });

      if (error) throw error;
      return data;
    },
    enabled: !!houseId && !!supabase,
  });

  // 7. Fetch active groceries
  const { data: shoppingItems = [], isLoading: isShoppingLoading } = useQuery({
    queryKey: ['shopping_items', houseId],
    queryFn: async () => {
      if (!houseId) return [];
      const { data, error } = await supabase
        .from('shopping_items')
        .select()
        .eq('house_id', houseId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!houseId && !!supabase,
  });

  const handleSignOut = async () => {
    if (supabase) {
      await supabase.auth.signOut();
    }
    setUser(null);
    window.location.reload();
  };

  const handleHouseSetupSuccess = () => {
    refetchProfile();
  };

  // Render auth setup if client not created, or user loading
  if (authLoading) {
    return (
      <div className="setup-container">
        <Activity className="spinner-icon text-purple" size={48} />
        <p style={{ marginTop: '16px', color: 'var(--text-secondary)' }}>Checking Session...</p>
      </div>
    );
  }

  // Not signed in
  if (!user || !supabase) {
    return <AuthPage onAuthSuccess={(sessionUser) => {
      setUser(sessionUser);
      triggerAuthCheck();
    }} />;
  }

  // Loading profile data
  if (isProfileLoading) {
    return (
      <div className="setup-container">
        <Activity className="spinner-icon text-purple" size={48} />
        <p style={{ marginTop: '16px', color: 'var(--text-secondary)' }}>Loading Roommate Profile...</p>
      </div>
    );
  }

  // Signed in but no house group
  if (!houseId) {
    return (
      <HouseSetup
        user={user}
        onHouseSetupSuccess={handleHouseSetupSuccess}
        onSignOut={handleSignOut}
      />
    );
  }

  // Wait for other queries if house setup is complete
  const globalLoading = isHouseLoading || isMembersLoading;

  if (globalLoading) {
    return (
      <div className="setup-container">
        <Activity className="spinner-icon text-purple" size={48} />
        <p style={{ marginTop: '16px', color: 'var(--text-secondary)' }}>Connecting Roommate Hub...</p>
      </div>
    );
  }

  // Render application shell tabs
  return (
    <Layout
      profile={profile}
      house={house}
      onSignOut={handleSignOut}
      activeTab={activeTab}
      setActiveTab={setActiveTab}
    >
      {activeTab === 'dashboard' && (
        <Dashboard
          profile={profile}
          house={house}
          houseMembers={houseMembers}
          expenses={expenses}
          chores={chores}
          shoppingItems={shoppingItems}
          setActiveTab={setActiveTab}
        />
      )}

      {activeTab === 'expenses' && (
        <Expenses
          profile={profile}
          houseId={houseId}
          houseMembers={houseMembers}
          expenses={expenses}
        />
      )}

      {activeTab === 'chores' && (
        <Chores
          profile={profile}
          houseId={houseId}
          houseMembers={houseMembers}
          chores={chores}
        />
      )}

      {activeTab === 'shopping' && (
        <Shopping
          profile={profile}
          houseId={houseId}
          houseMembers={houseMembers}
          shoppingItems={shoppingItems}
        />
      )}
    </Layout>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <MainAppShell />
    </QueryClientProvider>
  );
}
