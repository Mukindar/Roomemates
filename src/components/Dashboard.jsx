import React, { useMemo } from 'react';
import { Home, Calendar, CheckSquare, Clock, AlertTriangle, CheckCircle, ArrowRight, Users } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useMutation, useQueryClient } from '@tanstack/react-query';

export default function Dashboard({ profile, house, houseMembers, chores, setActiveTab }) {
    const queryClient = useQueryClient();

    // Group and filter chores by deadline
    const stats = useMemo(() => {
        const todayStr = new Date().toISOString().split('T')[0];

        const today = [];
        const upcoming = [];
        const overdue = [];
        const completedToday = [];

        chores.forEach(chore => {
            // Check if one-off is already completed
            const isOneOffCompleted = chore.frequency === 'one-off' && chore.last_completed_at;
            if (isOneOffCompleted) {
                // If completed today
                const completedDateStr = new Date(chore.last_completed_at).toISOString().split('T')[0];
                if (completedDateStr === todayStr) {
                    completedToday.push(chore);
                }
                return;
            }

            // check if recurring got completed today (due date shifted, last completed is today)
            if (chore.last_completed_at) {
                const completedDateStr = new Date(chore.last_completed_at).toISOString().split('T')[0];
                if (completedDateStr === todayStr) {
                    completedToday.push(chore);
                }
            }

            if (!chore.due_date) {
                upcoming.push(chore);
                return;
            }

            const dueDateStr = new Date(chore.due_date).toISOString().split('T')[0];

            if (dueDateStr < todayStr) {
                overdue.push(chore);
            } else if (dueDateStr === todayStr) {
                today.push(chore);
            } else {
                upcoming.push(chore);
            }
        });

        return { today, upcoming, overdue, completedToday };
    }, [chores]);

    // Mutation for completing a chore from the dashboard
    const completeChoreMutation = useMutation({
        mutationFn: async ({ choreId, currentAssigneeId, frequency, currentDueDate, name }) => {
            let updateFields = {
                last_completed_at: new Date().toISOString(),
                last_completed_by: profile.id
            };

            let nextAssigneeId = currentAssigneeId;

            // Rotate assignee if recurring
            if (frequency !== 'one-off' && houseMembers.length > 1) {
                // Determine order array
                const order = (chores.find(c => c.id === choreId)?.rotation_order || [])
                    .filter(uid => houseMembers.some(m => m.id === uid)); // Filter active only

                const activeQueue = order.length > 0 ? order : houseMembers.map(m => m.id);
                const currentIndex = activeQueue.indexOf(currentAssigneeId);
                const nextIndex = currentIndex !== -1 ? (currentIndex + 1) % activeQueue.length : 0;
                nextAssigneeId = activeQueue[nextIndex];
                updateFields.assigned_to = nextAssigneeId;
            }

            if (frequency !== 'one-off') {
                const nextDueDate = new Date(currentDueDate || new Date());
                if (frequency === 'daily') {
                    nextDueDate.setDate(nextDueDate.getDate() + 1);
                } else if (frequency === 'weekly') {
                    nextDueDate.setDate(nextDueDate.getDate() + 7);
                } else if (frequency === 'monthly') {
                    nextDueDate.setMonth(nextDueDate.getMonth() + 1);
                }
                updateFields.due_date = nextDueDate.toISOString();
            }

            // Apply updates
            const { error: choreErr } = await supabase
                .from('chores')
                .update(updateFields)
                .eq('id', choreId);
            if (choreErr) throw choreErr;

            // Insert History
            await supabase.from('chore_history').insert([{
                house_id: house.id,
                chore_id: choreId,
                chore_name: name,
                completed_by: profile.id,
                action_type: 'complete'
            }]);

            // Add notification if assignee changed
            if (nextAssigneeId !== currentAssigneeId) {
                const nextUser = houseMembers.find(m => m.id === nextAssigneeId);
                await supabase.from('chore_notifications').insert([{
                    house_id: house.id,
                    message: `${profile.name} completed "${name}". Next turn is yours!`,
                    profile_id: nextAssigneeId
                }]);
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries(['chores']);
            queryClient.invalidateQueries(['chore_history']);
            queryClient.invalidateQueries(['chore_notifications']);
        }
    });

    const handleQuickComplete = (chore) => {
        completeChoreMutation.mutate({
            choreId: chore.id,
            currentAssigneeId: chore.assigned_to,
            frequency: chore.frequency,
            currentDueDate: chore.due_date,
            name: chore.name
        });
    };

    // Calculate next person in rotation helper
    const getNextInRotation = (chore) => {
        if (chore.frequency === 'one-off' || houseMembers.length <= 1) return 'N/A';
        const order = (chore.rotation_order || []).filter(uid => houseMembers.some(m => m.id === uid));
        const activeQueue = order.length > 0 ? order : houseMembers.map(m => m.id);
        const currentIndex = activeQueue.indexOf(chore.assigned_to);
        if (currentIndex === -1) return houseMembers[0].name;
        const nextIndex = (currentIndex + 1) % activeQueue.length;
        const nextUser = houseMembers.find(m => m.id === activeQueue[nextIndex]);
        return nextUser ? nextUser.name : 'Unknown';
    };

    return (
        <div>
            <div className="welcome-banner">
                <h1>Welcome Back, {profile.name}!</h1>
                <p>Track your shared house cleanliness status at <strong>{house?.name || 'your household'}</strong>.</p>
            </div>

            {/* Stats Cards */}
            <div className="stats-grid">
                <div className="stat-card glass-card">
                    <div className="stat-icon warning-bg">
                        <AlertTriangle size={24} />
                    </div>
                    <div className="stat-info">
                        <span className="stat-value">{stats.overdue.length}</span>
                        <span className="stat-label">Overdue Tasks</span>
                    </div>
                </div>

                <div className="stat-card glass-card">
                    <div className="stat-icon purple-bg">
                        <Clock size={24} />
                    </div>
                    <div className="stat-info">
                        <span className="stat-value">{stats.today.length}</span>
                        <span className="stat-label">Due Today</span>
                    </div>
                </div>

                <div className="stat-card glass-card">
                    <div className="stat-icon success-bg">
                        <CheckCircle size={24} />
                    </div>
                    <div className="stat-info">
                        <span className="stat-value">{stats.completedToday.length}</span>
                        <span className="stat-label">Completed Today</span>
                    </div>
                </div>

                <div className="stat-card glass-card">
                    <div className="stat-icon cyan-bg">
                        <CheckSquare size={24} />
                    </div>
                    <div className="stat-info">
                        <span className="stat-value">
                            {chores.filter(c => c.assigned_to === profile.id && (c.frequency !== 'one-off' || !c.last_completed_at)).length}
                        </span>
                        <span className="stat-label">Your Active Chores</span>
                    </div>
                </div>
            </div>

            <div className="dashboard-sections">
                {/* Main section: Today and Overdue */}
                <div className="dash-mainSpaced spaced-y-6" style={{ display: 'flex', flexDirection: 'column', gap: '24px', flexGrow: 1 }}>
                    {/* Overdue Chores Card */}
                    {stats.overdue.length > 0 && (
                        <div className="glass-card module-card" style={{ border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                            <div className="module-header" style={{ marginBottom: '12px' }}>
                                <div className="module-title">
                                    <AlertTriangle size={20} className="text-danger" />
                                    <h3 className="text-danger">Overdue Chores</h3>
                                </div>
                            </div>
                            <div className="list-container">
                                {stats.overdue.map(chore => {
                                    const assignee = houseMembers.find(m => m.id === chore.assigned_to);
                                    return (
                                        <div key={chore.id} className="list-item" style={{ borderLeft: '3px solid #ef4444' }}>
                                            <div className="list-item-content">
                                                <button onClick={() => handleQuickComplete(chore)} className="list-item-checkbox" title="Complete Chore" />
                                                <div>
                                                    <p className="list-item-title">{chore.name}</p>
                                                    <small className="text-muted">
                                                        Assigned to: <strong>{assignee ? assignee.name : 'Anyone'}</strong> • Overdue since {new Date(chore.due_date).toLocaleDateString()}
                                                    </small>
                                                </div>
                                            </div>
                                            <span style={{ fontSize: '0.75rem', color: '#ef4444', fontWeight: 'bold' }}>OVERDUE</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Today's Chores */}
                    <div className="glass-card module-card">
                        <div className="module-header">
                            <div className="module-title">
                                <Clock size={20} className="text-purple" />
                                <h3>Today's Tasks</h3>
                            </div>
                            <button onClick={() => setActiveTab('chores')} className="btn btn-secondary btn-small">
                                View All
                            </button>
                        </div>
                        <div className="list-container">
                            {stats.today.length === 0 ? (
                                <p className="helper-text font-italic">No chores due today. Clean house, clean mind!</p>
                            ) : (
                                stats.today.map(chore => {
                                    const assignee = houseMembers.find(m => m.id === chore.assigned_to);
                                    return (
                                        <div key={chore.id} className="list-item">
                                            <div className="list-item-content">
                                                <button onClick={() => handleQuickComplete(chore)} className="list-item-checkbox" title="Complete Chore" />
                                                <div>
                                                    <p className="list-item-title">{chore.name}</p>
                                                    <small className="text-muted">
                                                        Assigned to: <strong>{assignee ? assignee.name : 'Anyone'}</strong>
                                                    </small>
                                                </div>
                                            </div>
                                            <span className="badge badge-secondary">{chore.frequency}</span>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>

                    {/* Rotation Queues */}
                    <div className="glass-card module-card">
                        <div className="module-header">
                            <div className="module-title">
                                <CheckSquare size={20} className="text-cyan" />
                                <h3>Chore Rotations</h3>
                            </div>
                        </div>
                        <div className="list-container">
                            {chores.filter(c => c.frequency !== 'one-off').length === 0 ? (
                                <p className="helper-text font-italic">No rotating chores currently scheduled.</p>
                            ) : (
                                chores.filter(c => c.frequency !== 'one-off').map(chore => {
                                    const assignee = houseMembers.find(m => m.id === chore.assigned_to);
                                    return (
                                        <div key={chore.id} className="list-item" style={{ padding: '12px 16px' }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                <span style={{ fontSize: '0.90rem', fontWeight: 'bold' }}>{chore.name}</span>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                                    <span>Current: <strong>{assignee ? assignee.name : 'Anyone'}</strong></span>
                                                    <ArrowRight size={10} />
                                                    <span>Next up: <strong>{getNextInRotation(chore)}</strong></span>
                                                </div>
                                            </div>
                                            <span className="badge badge-primary">{chore.frequency}</span>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>

                {/* Right side: Roommates */}
                <div className="dash-side" style={{ minWidth: '260px' }}>
                    <div className="glass-card module-card">
                        <div className="module-header" style={{ marginBottom: '16px' }}>
                            <div className="module-title">
                                <Users size={20} className="text-cyan" />
                                <h3>Flatmates ({houseMembers.length})</h3>
                            </div>
                        </div>

                        <div className="spaced-y-4">
                            {houseMembers.map(member => (
                                <div key={member.id} className="user-badge" style={{ padding: '8px' }}>
                                    <div className="user-avatar" style={{ minWidth: '32px', width: '32px', height: '32px', borderRadius: '50%' }}>
                                        {member.name.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="user-info">
                                        <span className="user-name" style={{ fontSize: '0.85rem' }}>{member.name} {member.id === profile.id && '(You)'}</span>
                                        <span className="house-name-text" style={{ fontSize: '0.7rem' }}>Joined {new Date(member.created_at).toLocaleDateString()}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
