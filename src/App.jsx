import React, { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabaseClient';
import AuthPage from './components/AuthPage';
import HouseSetup from './components/HouseSetup';
import Layout from './components/Layout';
import Dashboard from './components/Dashboard';
import Chores from './components/Chores';
import Calendar from './components/Calendar';
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

  // 5. Fetch chores
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

  // 6. Fetch chore notifications
  const { data: notifications = [] } = useQuery({
    queryKey: ['chore_notifications', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('chore_notifications')
        .select()
        .eq('profile_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!user && !!supabase,
  });

  // 7. Fetch chore history
  const { data: choreHistory = [] } = useQuery({
    queryKey: ['chore_history', houseId],
    queryFn: async () => {
      if (!houseId) return [];
      const { data, error } = await supabase
        .from('chore_history')
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

  const handleMarkNotificationRead = async (notificationId) => {
    if (!supabase) return;
    await supabase
      .from('chore_notifications')
      .update({ is_read: true })
      .eq('id', notificationId);
    qc.invalidateQueries(['chore_notifications', user?.id]);
  };

  // Every Sunday background automatic weekly chore rotation trigger
  useEffect(() => {
    if (!supabase || !houseId || chores.length === 0 || houseMembers.length === 0) return;

    const today = new Date();
    // Get last Sunday at 00:00:00
    const lastSunday = new Date(today);
    lastSunday.setDate(today.getDate() - today.getDay());
    lastSunday.setHours(0, 0, 0, 0);

    const checkAndPerformRotations = async () => {
      // Find all weekly rotating chores which haven't been rotated since last Sunday
      const rotatingWeeklyChores = chores.filter(c =>
        c.frequency === 'weekly' &&
        c.rotation_type === 'rotating' &&
        (!c.last_rotated_at || new Date(c.last_rotated_at) < lastSunday)
      );

      if (rotatingWeeklyChores.length === 0) return;

      for (const chore of rotatingWeeklyChores) {
        let nextAssigneeId = chore.assigned_to;
        const order = (chore.rotation_order || []).filter(uid => houseMembers.some(m => m.id === uid));
        const activeQueue = order.length > 0 ? order : houseMembers.map(m => m.id);
        const currentIndex = activeQueue.indexOf(chore.assigned_to);
        const nextIndex = currentIndex !== -1 ? (currentIndex + 1) % activeQueue.length : 0;
        nextAssigneeId = activeQueue[nextIndex];

        // Shift due date by 7 days
        const nextDueDate = new Date(chore.due_date || new Date());
        nextDueDate.setDate(nextDueDate.getDate() + 7);

        // Update chore in database
        await supabase
          .from('chores')
          .update({
            assigned_to: nextAssigneeId,
            last_rotated_at: new Date().toISOString(),
            due_date: nextDueDate.toISOString()
          })
          .eq('id', chore.id);

        // History log rotation
        await supabase.from('chore_history').insert([{
          house_id: houseId,
          chore_id: chore.id,
          chore_name: chore.name,
          completed_by: profile.id,
          action_type: 'skip'
        }]);

        // Alert notice
        await supabase.from('chore_notifications').insert([{
          house_id: houseId,
          message: `Weekly Rotation: "${chore.name}" has been rotated to you for the new week!`,
          profile_id: nextAssigneeId
        }]);
      }

      qc.invalidateQueries(['chores']);
      qc.invalidateQueries(['chore_history']);
      qc.invalidateQueries(['chore_notifications', user?.id]);
    };

    checkAndPerformRotations();
  }, [chores, houseMembers, houseId, qc, profile?.id, user?.id]);

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
  const globalLoading = isHouseLoading || isMembersLoading || isChoresLoading;

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
      notifications={notifications}
      onMarkNotificationRead={handleMarkNotificationRead}
    >
      {activeTab === 'dashboard' && (
        <Dashboard
          profile={profile}
          house={house}
          houseMembers={houseMembers}
          chores={chores}
          setActiveTab={setActiveTab}
        />
      )}

      {activeTab === 'chores' && (
        <Chores
          profile={profile}
          houseId={houseId}
          houseMembers={houseMembers}
          chores={chores}
          choreHistory={choreHistory}
        />
      )}

      {activeTab === 'calendar' && (
        <Calendar
          profile={profile}
          house={house}
          houseMembers={houseMembers}
          chores={chores}
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
