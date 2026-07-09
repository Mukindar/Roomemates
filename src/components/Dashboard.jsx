import React, { useMemo, useState } from 'react';
import { Home, Calendar, CheckSquare, Clock, AlertTriangle, CheckCircle, ArrowRight, Users, Star } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useMutation, useQueryClient } from '@tanstack/react-query';

export default function Dashboard({ profile, house, houseMembers, chores, setActiveTab, setChoreSubTab }) {
    const queryClient = useQueryClient();
    const [starRatings, setStarRatings] = useState({}); // { choreId: rating }
    const [todayFilterUser, setTodayFilterUser] = useState('all');

    // Group and filter chores by deadline
    const stats = useMemo(() => {
        const todayStr = new Date().toISOString().split('T')[0];

        const today = [];
        const upcoming = [];
        const overdue = [];
        const completedToday = [];
        const pendingApproval = [];

        chores.forEach(chore => {
            // Check if chore is pending validation/approval
            if (chore.is_pending_approval) {
                pendingApproval.push(chore);
                return;
            }

            const isOneOffCompleted = chore.frequency === 'one-off' && chore.last_completed_at;
            if (isOneOffCompleted) {
                const completedDateStr = new Date(chore.last_completed_at).toISOString().split('T')[0];
                if (completedDateStr === todayStr && chore.last_completed_by === profile.id) {
                    completedToday.push(chore);
                }
                return;
            }

            if (chore.last_completed_at) {
                const completedDateStr = new Date(chore.last_completed_at).toISOString().split('T')[0];
                if (completedDateStr === todayStr && chore.last_completed_by === profile.id) {
                    completedToday.push(chore);
                }
            }

            if (!chore.due_date) {
                if (chore.assigned_to === profile.id || !chore.assigned_to) {
                    upcoming.push(chore);
                }
                return;
            }

            const dueDateStr = new Date(chore.due_date).toISOString().split('T')[0];

            if (dueDateStr < todayStr) {
                if (chore.assigned_to === profile.id || !chore.assigned_to) {
                    overdue.push(chore);
                }
            } else if (dueDateStr === todayStr) {
                today.push(chore);
            } else {
                if (chore.assigned_to === profile.id || !chore.assigned_to) {
                    upcoming.push(chore);
                }
            }
        });

        return { today, upcoming, overdue, completedToday, pendingApproval };
    }, [chores, profile.id]);

    const displayedTodayChores = useMemo(() => {
        return stats.today.filter(chore => {
            if (todayFilterUser === 'all') return true;
            if (todayFilterUser === 'me') return chore.assigned_to === profile.id || !chore.assigned_to;
            return chore.assigned_to === todayFilterUser;
        });
    }, [stats.today, todayFilterUser, profile.id]);

    // Mutation to Claim Completion (marks chore as pending approval)
    const claimChoreMutation = useMutation({
        mutationFn: async (chore) => {
            const { error } = await supabase
                .from('chores')
                .update({
                    is_pending_approval: true,
                    pending_completed_by: profile.id,
                    approval_claimed_at: new Date().toISOString()
                })
                .eq('id', chore.id);
            if (error) throw error;

            // Generate notification for other roommates
            const otherMembers = houseMembers.filter(m => m.id !== profile.id);
            for (const member of otherMembers) {
                await supabase.from('chore_notifications').insert([{
                    house_id: house.id,
                    message: `${profile.name} claims they completed "${chore.name}". Please approve and rate!`,
                    profile_id: member.id
                }]);
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries(['chores']);
            queryClient.invalidateQueries(['chore_notifications']);
        },
        onError: (error) => {
            alert(`Database request failed: ${error.message}\n\nIf you see column errors, please make sure you ran the SQL query in walkthrough.md in your Supabase SQL Editor to add the approval schema columns!`);
        }
    });

    // Mutation for final approval of a chore
    const approveChoreMutation = useMutation({
        mutationFn: async ({ choreId, currentAssigneeId, frequency, currentDueDate, name, rating, claimantId }) => {
            let updateFields = {
                last_completed_at: new Date().toISOString(),
                last_completed_by: claimantId,
                is_pending_approval: false,
                pending_completed_by: null,
                approval_claimed_at: null
            };

            let nextAssigneeId = currentAssigneeId;

            // Rotate assignee if recurring
            if (frequency !== 'one-off' && houseMembers.length > 1) {
                const targetChore = chores.find(c => c.id === choreId);
                const order = (targetChore?.rotation_order || []).filter(uid => houseMembers.some(m => m.id === uid));
                const activeQueue = order.length > 0 ? order : houseMembers.map(m => m.id);
                // Shift next turn to next person in queue starting from claimant
                const currentIndex = activeQueue.indexOf(claimantId);
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

            // Insert History with Rating and Approver details
            await supabase.from('chore_history').insert([{
                house_id: house.id,
                chore_id: choreId,
                chore_name: name,
                completed_by: claimantId,
                action_type: 'complete',
                rating: rating,
                approved_by: profile.id
            }]);

            // Add notification to the claimant
            await supabase.from('chore_notifications').insert([{
                house_id: house.id,
                message: `Your completion of "${name}" was approved with a ${rating}-star rating!`,
                profile_id: claimantId
            }]);

            // Add notification if assignee changed
            if (nextAssigneeId !== claimantId) {
                await supabase.from('chore_notifications').insert([{
                    house_id: house.id,
                    message: `${name} has been rotated. Next turn is yours!`,
                    profile_id: nextAssigneeId
                }]);
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries(['chores']);
            queryClient.invalidateQueries(['chore_history']);
            queryClient.invalidateQueries(['chore_notifications']);
        },
        onError: (error) => {
            alert(`Database request failed: ${error.message}\n\nIf you see column errors, please make sure you ran the SQL query in walkthrough.md in your Supabase SQL Editor to add the approval schema columns!`);
        }
    });

    // Mutation to reject a completion claim
    const rejectChoreMutation = useMutation({
        mutationFn: async ({ choreId, claimantId, name }) => {
            const { error } = await supabase
                .from('chores')
                .update({
                    is_pending_approval: false,
                    pending_completed_by: null,
                    approval_claimed_at: null
                })
                .eq('id', choreId);
            if (error) throw error;

            // Log notification to claimant
            await supabase.from('chore_notifications').insert([{
                house_id: house.id,
                message: `Your completion claim for "${name}" was rejected. Please review the chore.`,
                profile_id: claimantId
            }]);
        },
        onSuccess: () => {
            queryClient.invalidateQueries(['chores']);
            queryClient.invalidateQueries(['chore_notifications']);
        },
        onError: (error) => {
            alert(`Database request failed: ${error.message}\n\nIf you see column errors, please make sure you ran the SQL query in walkthrough.md in your Supabase SQL Editor to add the approval schema columns!`);
        }
    });

    const handleQuickComplete = (chore) => {
        if (houseMembers.length <= 1) {
            // Complete immediately if sole roommate
            approveChoreMutation.mutate({
                choreId: chore.id,
                currentAssigneeId: chore.assigned_to,
                frequency: chore.frequency,
                currentDueDate: chore.due_date,
                name: chore.name,
                rating: 5,
                claimantId: profile.id
            });
        } else {
            claimChoreMutation.mutate(chore);
        }
    };

    const handleSelectStar = (choreId, ratingValue) => {
        setStarRatings({ ...starRatings, [choreId]: ratingValue });
    };

    const handleApproveClaim = (chore) => {
        const rating = starRatings[chore.id] || 5; // Default to 5 stars if not selected
        approveChoreMutation.mutate({
            choreId: chore.id,
            currentAssigneeId: chore.assigned_to,
            frequency: chore.frequency,
            currentDueDate: chore.due_date,
            name: chore.name,
            rating: rating,
            claimantId: chore.pending_completed_by
        });
    };

    const handleRejectClaim = (chore) => {
        if (!confirm(`Are you sure you want to reject the completion claim for "${chore.name}"?`)) return;
        rejectChoreMutation.mutate({
            choreId: chore.id,
            claimantId: chore.pending_completed_by,
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

    // Filtering verifications where current user is NOT claimant (unless only member)
    const verificationsRequired = useMemo(() => {
        return stats.pendingApproval.filter(c => houseMembers.length === 1 || c.pending_completed_by !== profile.id);
    }, [stats.pendingApproval, houseMembers, profile.id]);

    return (
        <div>
            <div className="welcome-banner">
                <h1>Welcome Back, {profile.name}!</h1>
                <p>Track your shared house cleanliness status at <strong>{house?.name || 'your household'}</strong>.</p>
            </div>

            {/* Stats Cards */}
            <div className="stats-grid">
                <div className="stat-card glass-card clickable-card" onClick={() => { setActiveTab('chores'); setChoreSubTab('overdue'); }}>
                    <div className="stat-icon warning-bg">
                        <AlertTriangle size={24} />
                    </div>
                    <div className="stat-info">
                        <span className="stat-value">{stats.overdue.length}</span>
                        <span className="stat-label">Overdue Tasks</span>
                    </div>
                </div>

                <div className="stat-card glass-card clickable-card" onClick={() => { setActiveTab('chores'); setChoreSubTab('today'); }}>
                    <div className="stat-icon purple-bg">
                        <Clock size={24} />
                    </div>
                    <div className="stat-info">
                        <span className="stat-value">{stats.today.length}</span>
                        <span className="stat-label">Due Today</span>
                    </div>
                </div>

                <div className="stat-card glass-card clickable-card" onClick={() => { setActiveTab('chores'); setChoreSubTab('completed'); }}>
                    <div className="stat-icon success-bg">
                        <CheckCircle size={24} />
                    </div>
                    <div className="stat-info">
                        <span className="stat-value">{stats.completedToday.length}</span>
                        <span className="stat-label">Completed Today</span>
                    </div>
                </div>

                <div className="stat-card glass-card clickable-card" onClick={() => { setActiveTab('chores'); setChoreSubTab('yours'); }}>
                    <div className="stat-icon cyan-bg">
                        <CheckSquare size={24} />
                    </div>
                    <div className="stat-info">
                        <span className="stat-value">
                            {chores.filter(c => c.assigned_to === profile.id && !c.is_pending_approval && (c.frequency !== 'one-off' || !c.last_completed_at)).length}
                        </span>
                        <span className="stat-label">Your Active Chores</span>
                    </div>
                </div>
            </div>

            <div className="dashboard-sections">
                {/* Main section: Today, Verifications and Overdue */}
                <div className="dash-mainSpaced spaced-y-6" style={{ display: 'flex', flexDirection: 'column', gap: '24px', flexGrow: 1 }}>
                    {/* Pending Approvals Section */}
                    {verificationsRequired.length > 0 && (
                        <div className="glass-card module-card" style={{ border: '1px solid rgba(168, 85, 247, 0.3)' }}>
                            <div className="module-header" style={{ marginBottom: '12px' }}>
                                <div className="module-title">
                                    <Star size={20} style={{ color: '#ef4444' }} />
                                    <h3 style={{ color: 'var(--accent-purple)' }}>Verifications Required</h3>
                                </div>
                            </div>
                            <div className="list-container">
                                {verificationsRequired.map(chore => {
                                    const claimant = houseMembers.find(m => m.id === chore.pending_completed_by);
                                    const activeRating = starRatings[chore.id] || 5;

                                    return (
                                        <div key={chore.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '10px', borderLeft: '3px solid var(--accent-purple)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <div>
                                                    <p className="list-item-title" style={{ fontSize: '0.95rem' }}>{chore.name}</p>
                                                    <small className="text-secondary">
                                                        Completed by: <strong>{claimant ? claimant.name : 'Roommate'}</strong>
                                                    </small>
                                                </div>
                                                <div style={{ display: 'flex', gap: '6px' }}>
                                                    <button onClick={() => handleApproveClaim(chore)} className="btn btn-primary btn-small">Approve</button>
                                                    <button onClick={() => handleRejectClaim(chore)} className="btn btn-secondary btn-small" style={{ color: '#ef4444' }}>Reject</button>
                                                </div>
                                            </div>

                                            {/* Star Rating Selector */}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '8px' }}>
                                                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Rating: </span>
                                                <div style={{ display: 'flex', gap: '4px' }}>
                                                    {[1, 2, 3, 4, 5].map(star => {
                                                        const isSelected = star <= activeRating;
                                                        return (
                                                            <button
                                                                key={star}
                                                                type="button"
                                                                onClick={() => handleSelectStar(chore.id, star)}
                                                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                                                            >
                                                                <Star
                                                                    size={16}
                                                                    fill={isSelected ? '#fbbf24' : 'none'}
                                                                    color={isSelected ? '#fbbf24' : 'var(--text-muted)'}
                                                                />
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

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
                        <div className="module-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                            <div className="module-title">
                                <Clock size={20} className="text-purple" />
                                <h3>Today's Tasks</h3>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <select
                                    value={todayFilterUser}
                                    onChange={(e) => setTodayFilterUser(e.target.value)}
                                    className="input-field"
                                    style={{
                                        padding: '4px 24px 4px 8px',
                                        fontSize: '0.75rem',
                                        width: 'auto',
                                        height: '28px',
                                        margin: 0,
                                        backgroundColor: 'var(--bg-tertiary)',
                                        border: '1px solid var(--border-color)',
                                        borderRadius: 'var(--radius-sm)',
                                        color: 'var(--text-primary)',
                                        cursor: 'pointer'
                                    }}
                                >
                                    <option value="all">All Roommates</option>
                                    <option value="me">Assigned to Me</option>
                                    {houseMembers.filter(m => m.id !== profile.id).map(member => (
                                        <option key={member.id} value={member.id}>{member.name}</option>
                                    ))}
                                </select>
                                <button onClick={() => { setActiveTab('chores'); setChoreSubTab('today'); }} className="btn btn-secondary btn-small">
                                    View All
                                </button>
                            </div>
                        </div>
                        <div className="list-container">
                            {displayedTodayChores.length === 0 ? (
                                <p className="helper-text font-italic">No chores due today. Clean house, clean mind!</p>
                            ) : (
                                displayedTodayChores.map(chore => {
                                    const assignee = houseMembers.find(m => m.id === chore.assigned_to);
                                    return (
                                        <div key={chore.id} className="list-item">
                                            <div className="list-item-content">
                                                <button onClick={() => handleQuickComplete(chore)} className="list-item-checkbox" title="Claim Completion" />
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
                            {chores.filter(c => c.frequency !== 'one-off').map(chore => {
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
                            })}
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
