import React, { useState, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { CheckSquare, Plus, RotateCw, Calendar, User, Check, Trash2, ArrowRightLeft, FastForward, History, Star } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

export default function Chores({
    profile,
    houseId,
    houseMembers,
    chores,
    choreHistory = [],
    choreSubTab = 'all',
    setChoreSubTab
}) {
    const queryClient = useQueryClient();
    const [showAddModal, setShowAddModal] = useState(false);
    const [showSwapModal, setShowSwapModal] = useState(false);
    const [selectedChoreToSwap, setSelectedChoreToSwap] = useState(null);
    const [swapAssignee, setSwapAssignee] = useState('');
    const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);
    const [starRatings, setStarRatings] = useState({}); // { choreId: rating }

    const [showSkipModal, setShowSkipModal] = useState(false);
    const [selectedChoreToSkip, setSelectedChoreToSkip] = useState(null);
    const [skipAssignee, setSkipAssignee] = useState('');

    const getActiveAssignees = (chore) => {
        if (chore.rotation_type === 'fixed') {
            if (Array.isArray(chore.rotation_order) && chore.rotation_order.length > 0) {
                return chore.rotation_order.filter(id => houseMembers.some(m => m.id === id));
            }
            return chore.assigned_to ? [chore.assigned_to] : [];
        }
        // Rotating chore
        const order = (chore.rotation_order || []).filter(uid => houseMembers.some(m => m.id === uid));
        const queue = order.length > 0 ? order : houseMembers.map(m => m.id);
        if (queue.length === 0) return [];

        const primaryId = chore.assigned_to || (queue.length > 0 ? queue[0] : null);
        const currentIndex = queue.indexOf(primaryId);
        if (currentIndex === -1) {
            return primaryId ? [primaryId] : [];
        }
        const count = chore.rotation_count || 1;
        const activeIds = [];
        for (let i = 0; i < count; i++) {
            const idx = (currentIndex + i) % queue.length;
            if (!activeIds.includes(queue[idx])) {
                activeIds.push(queue[idx]);
            }
        }
        return activeIds;
    };

    const filteredChores = useMemo(() => {
        const todayStr = new Date().toISOString().split('T')[0];
        return chores.filter(chore => {
            const isOneOffCompleted = chore.frequency === 'one-off' && chore.last_completed_at;

            if (choreSubTab === 'all') {
                return true;
            }

            if (choreSubTab === 'yours') {
                const activeIds = getActiveAssignees(chore);
                const isAssignedToUser = activeIds.includes(profile.id);
                return isAssignedToUser && !isOneOffCompleted;
            }

            if (choreSubTab === 'today') {
                if (!chore.due_date) return false;
                const dueDateStr = new Date(chore.due_date).toISOString().split('T')[0];
                return dueDateStr === todayStr && !isOneOffCompleted;
            }

            if (choreSubTab === 'overdue') {
                if (!chore.due_date) return false;
                const dueDateStr = new Date(chore.due_date).toISOString().split('T')[0];
                return dueDateStr < todayStr && !isOneOffCompleted && !chore.is_pending_approval;
            }

            return true;
        });
    }, [chores, choreSubTab, profile.id, houseMembers]);

    const completedTodayHistory = useMemo(() => {
        const todayStr = new Date().toISOString().split('T')[0];
        return (choreHistory || []).filter(item => {
            if (!item.completed_at) return false;
            const completedDateStr = new Date(item.completed_at).toISOString().split('T')[0];
            return completedDateStr === todayStr;
        });
    }, [choreHistory]);

    const [name, setName] = useState('');
    const [desc, setDesc] = useState('');
    const [assignedTo, setAssignedTo] = useState(profile.id);
    const [frequency, setFrequency] = useState('one-off');
    const [dueDate, setDueDate] = useState('');
    const [rotationType, setRotationType] = useState('rotating');
    const [rotationQueue, setRotationQueue] = useState(houseMembers.map(m => m.id));
    const [rotationCount, setRotationCount] = useState(1);

    const [submitError, setSubmitError] = useState('');
    const [loading, setLoading] = useState(false);


    // 1. Mutation: Add new chore
    const appendChoreMutation = useMutation({
        mutationFn: async (newChore) => {
            const { data, error } = await supabase
                .from('chores')
                .insert([newChore])
                .select();
            if (error) throw error;
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries(['chores']);
            setShowAddModal(false);
            setName('');
            setDesc('');
            setAssignedTo(profile.id);
            setFrequency('one-off');
            setDueDate('');
            setRotationType('rotating');
            setRotationQueue(houseMembers.map(m => m.id));
            setRotationCount(1);
        },
        onError: (error) => {
            alert(`Database request failed: ${error.message}`);
        }
    });

    // 2. Mutation: Claim completion (flag pending approval)
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
                    house_id: houseId,
                    message: `${profile.name} completed "${chore.name}". Please approve/rate!`,
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

    // 3. Mutation: Approve completion (final resolve, rotate & log)
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
                const count = targetChore?.rotation_count || 1;
                const primaryAssigneeId = targetChore?.assigned_to || claimantId;
                const currentIndex = activeQueue.indexOf(primaryAssigneeId);
                const nextIndex = currentIndex !== -1 ? (currentIndex + count) % activeQueue.length : 0;
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

            const { error: choreErr } = await supabase
                .from('chores')
                .update(updateFields)
                .eq('id', choreId);
            if (choreErr) throw choreErr;

            // Log details history
            await supabase.from('chore_history').insert([{
                house_id: houseId,
                chore_id: choreId,
                chore_name: name,
                completed_by: claimantId,
                action_type: 'complete',
                rating: rating,
                approved_by: profile.id
            }]);

            // Notify claimant
            await supabase.from('chore_notifications').insert([{
                house_id: houseId,
                message: `Your completion of "${name}" was approved with a ${rating}-star rating!`,
                profile_id: claimantId
            }]);

            // Notify next assignee
            if (nextAssigneeId !== claimantId) {
                await supabase.from('chore_notifications').insert([{
                    house_id: houseId,
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

    // 4. Mutation: Reject claim
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

            await supabase.from('chore_notifications').insert([{
                house_id: houseId,
                message: `Your completion claim for "${name}" was rejected. Please review.`,
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

    // 5. Mutation: Skip turn
    const skipTurnMutation = useMutation({
        mutationFn: async ({ choreId, targetRoommateId, name }) => {
            const { error } = await supabase
                .from('chores')
                .update({ assigned_to: targetRoommateId })
                .eq('id', choreId);
            if (error) throw error;

            await supabase.from('chore_history').insert([{
                house_id: houseId,
                chore_id: choreId,
                chore_name: name,
                completed_by: profile.id,
                action_type: 'skip'
            }]);

            await supabase.from('chore_notifications').insert([{
                house_id: houseId,
                message: `${profile.name} skipped turn for "${name}". It has been passed to you!`,
                profile_id: targetRoommateId
            }]);
        },
        onSuccess: () => {
            queryClient.invalidateQueries(['chores']);
            queryClient.invalidateQueries(['chore_history']);
            queryClient.invalidateQueries(['chore_notifications']);
            setShowSkipModal(false);
            setSelectedChoreToSkip(null);
            setSkipAssignee('');
        },
        onError: (error) => {
            alert(`Database request failed: ${error.message}`);
        }
    });

    // 6. Mutation: Swap turn
    const swapTurnMutation = useMutation({
        mutationFn: async ({ choreId, targetRoommateId, name }) => {
            const { error } = await supabase
                .from('chores')
                .update({ assigned_to: targetRoommateId })
                .eq('id', choreId);
            if (error) throw error;

            await supabase.from('chore_history').insert([{
                house_id: houseId,
                chore_id: choreId,
                chore_name: name,
                completed_by: profile.id,
                action_type: 'swap'
            }]);

            await supabase.from('chore_notifications').insert([{
                house_id: houseId,
                message: `${profile.name} swapped the turn for "${name}" with you.`,
                profile_id: targetRoommateId
            }]);
        },
        onSuccess: () => {
            queryClient.invalidateQueries(['chores']);
            queryClient.invalidateQueries(['chore_history']);
            queryClient.invalidateQueries(['chore_notifications']);
            setShowSwapModal(false);
            setSelectedChoreToSwap(null);
            setSwapAssignee('');
        },
        onError: (error) => {
            alert(`Database request failed: ${error.message}`);
        }
    });

    // 7. Mutation: Delete chore
    const deleteChoreMutation = useMutation({
        mutationFn: async (choreId) => {
            const { error } = await supabase.from('chores').delete().eq('id', choreId);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries(['chores']);
        },
        onError: (error) => {
            alert(`Database request failed: ${error.message}`);
        }
    });

    const handleAddSubmit = async (e) => {
        e.preventDefault();
        setSubmitError('');

        if (!name.trim()) {
            setSubmitError('Please enter a chore name.');
            return;
        }

        if (rotationType === 'rotating' && rotationQueue.length === 0) {
            setSubmitError('Please select at least one roommate for the rotation queue.');
            return;
        }

        setLoading(true);

        const finalAssignedTo = rotationType === 'fixed'
            ? (rotationQueue.length > 0 ? rotationQueue[0] : (assignedTo || null))
            : (assignedTo || (rotationQueue.length > 0 ? rotationQueue[0] : null));

        try {
            await appendChoreMutation.mutateAsync({
                house_id: houseId,
                name,
                description: desc,
                assigned_to: finalAssignedTo,
                frequency,
                due_date: dueDate ? new Date(dueDate).toISOString() : null,
                rotation_type: rotationType,
                rotation_order: rotationQueue,
                rotation_count: rotationType === 'rotating' ? parseInt(rotationCount) : 1
            });
            setShowAddModal(false);
            setName('');
            setDesc('');
            setAssignedTo('');
            setRotationType('rotating');
            setRotationQueue(houseMembers.map(m => m.id));
            setRotationCount(1);
            setFrequency('one-off');
            setDueDate('');
        } catch (err) {
            setSubmitError(err.message || 'Error occurred while saving chore.');
        } finally {
            setLoading(false);
        }
    };

    const handleCompletePress = async (chore) => {
        if (houseMembers.length <= 1) {
            // Self-approval
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

    const handleSelectStar = (choreId, val) => {
        setStarRatings({ ...starRatings, [choreId]: val });
    };

    const handleApprovePress = (chore) => {
        const rating = starRatings[chore.id] || 5;
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

    const handleRejectPress = (chore) => {
        if (!confirm(`Are you sure you want to reject the completion claim for "${chore.name}"?`)) return;
        rejectChoreMutation.mutate({
            choreId: chore.id,
            claimantId: chore.pending_completed_by,
            name: chore.name
        });
    };

    const handleSkipOpen = (chore) => {
        setSelectedChoreToSkip(chore);
        setShowSkipModal(true);
    };

    const handleSkipSubmit = async (e) => {
        e.preventDefault();
        if (!skipAssignee) return;
        try {
            await skipTurnMutation.mutateAsync({
                choreId: selectedChoreToSkip.id,
                targetRoommateId: skipAssignee,
                name: selectedChoreToSkip.name
            });
        } catch (err) {
            alert('Failed to skip: ' + err.message);
        }
    };

    const handleSwapOpen = (chore) => {
        setSelectedChoreToSwap(chore);
        setShowSwapModal(true);
    };

    const handleSwapSubmit = async (e) => {
        e.preventDefault();
        if (!swapAssignee) return;
        try {
            await swapTurnMutation.mutateAsync({
                choreId: selectedChoreToSwap.id,
                targetRoommateId: swapAssignee,
                name: selectedChoreToSwap.name
            });
        } catch (err) {
            alert('Failed to swap: ' + err.message);
        }
    };

    const handleDeleteChore = async (id) => {
        if (!confirm('Are you sure you want to delete this chore? This cannot be undone.')) return;
        try {
            await deleteChoreMutation.mutateAsync(id);
        } catch (err) {
            alert('Failed to delete: ' + err.message);
        }
    };

    const handleToggleQueueMember = (uid) => {
        if (rotationQueue.includes(uid)) {
            setRotationQueue(rotationQueue.filter(id => id !== uid));
        } else {
            setRotationQueue([...rotationQueue, uid]);
        }
    };

    return (
        <div>
            <div className="section-header">
                <div>
                    <h2>Roommate Chores List</h2>
                    <p className="text-secondary">Keep your shared flat running smoothly. Manage schedules and validation reviews.</p>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <button onClick={() => setShowHistoryDrawer(true)} className="btn btn-secondary">
                        <History size={18} style={{ marginRight: '6px' }} /> History Log
                    </button>
                    <button onClick={() => setShowAddModal(true)} className="btn btn-primary">
                        <Plus size={18} /> Add Chore
                    </button>
                </div>
            </div>

            {/* Sub Tabs Panel */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', overflowX: 'auto', paddingBottom: '4px' }}>
                {[
                    { id: 'all', label: 'All Rotations' },
                    { id: 'yours', label: 'Your Active Chores' },
                    { id: 'today', label: 'Due Today' },
                    { id: 'overdue', label: 'Overdue' },
                    { id: 'completed', label: 'Completed Today' }
                ].map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setChoreSubTab(tab.id)}
                        className={`btn ${choreSubTab === tab.id ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ padding: '8px 14px', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* List Chores */}
            <div className="glass-card">
                <h3 style={{ marginBottom: '16px' }}>
                    {choreSubTab === 'all' && 'All Daily/Weekly Rotations'}
                    {choreSubTab === 'yours' && 'Your Active Chores'}
                    {choreSubTab === 'today' && "Chores Due Today"}
                    {choreSubTab === 'overdue' && 'Overdue Household Chores'}
                    {choreSubTab === 'completed' && 'Chores Completed/Rateable Today'}
                </h3>

                {choreSubTab === 'completed' ? (
                    completedTodayHistory.length === 0 ? (
                        <p className="helper-text font-italic">No chores completed today yet.</p>
                    ) : (
                        <div className="list-container">
                            {completedTodayHistory.map((item, idx) => {
                                const worker = houseMembers.find(m => m.id === item.completed_by);
                                const approver = houseMembers.find(m => m.id === item.approved_by);
                                return (
                                    <div key={idx} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '6px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div>
                                                <p className="list-item-title" style={{ color: 'var(--success)' }}>✔ {item.chore_name}</p>
                                                <small className="text-secondary" style={{ display: 'block', marginTop: '4px' }}>
                                                    Completed by: <strong>{worker ? worker.name : 'Unknown'}</strong>
                                                    {approver && <span> • Approved by: <strong>{approver.name}</strong></span>}
                                                </small>
                                            </div>
                                            {item.rating && (
                                                <div style={{ display: 'flex', gap: '2px' }}>
                                                    {[1, 2, 3, 4, 5].map(star => (
                                                        <Star
                                                            key={star}
                                                            size={14}
                                                            fill={star <= item.rating ? '#fbbf24' : 'none'}
                                                            color={star <= item.rating ? '#fbbf24' : 'var(--text-muted)'}
                                                        />
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )
                ) : filteredChores.length === 0 ? (
                    <p className="helper-text font-italic">No chores found in this category.</p>
                ) : (
                    <div className="list-container">
                        {filteredChores.map(chore => {
                            const assignee = houseMembers.find(m => m.id === chore.assigned_to);
                            const isOneOffCompleted = chore.frequency === 'one-off' && chore.last_completed_at;

                            // Pending approval states
                            const isClaimedByMe = chore.is_pending_approval && chore.pending_completed_by === profile.id;
                            const isClaimedByOther = chore.is_pending_approval && chore.pending_completed_by !== profile.id;
                            const claimant = houseMembers.find(m => m.id === chore.pending_completed_by);

                            return (
                                <div key={chore.id} className="list-item" style={{ opacity: isOneOffCompleted ? 0.6 : 1, flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center w-full' }}>
                                        <div className="list-item-content">
                                            {/* Checkbox triggers verification claim or quick complete */}
                                            <button
                                                onClick={() => !isOneOffCompleted && !chore.is_pending_approval && handleCompletePress(chore)}
                                                disabled={isOneOffCompleted || chore.is_pending_approval}
                                                className={`list-item-checkbox ${isOneOffCompleted ? 'checked' : ''} ${chore.is_pending_approval ? 'disabled-checkbox' : ''}`}
                                                title={chore.is_pending_approval ? "Pending Approval" : "Complete Chore"}
                                                style={{ cursor: chore.is_pending_approval ? 'default' : 'pointer' }}
                                            >
                                                {isOneOffCompleted && <Check size={14} />}
                                            </button>

                                            <div>
                                                <p className={`list-item-title ${isOneOffCompleted ? 'completed' : ''}`}>
                                                    {chore.name}
                                                </p>
                                                <small className="text-secondary" style={{ display: 'block', display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', marginTop: '4px' }}>
                                                    {chore.description && <span>{chore.description} • </span>}
                                                    {chore.rotation_type === 'rotating' ? (
                                                        <>
                                                            <span>Assignees: <strong>{(() => {
                                                                const activeIds = getActiveAssignees(chore);
                                                                return activeIds.map(uid => houseMembers.find(m => m.id === uid)?.name).filter(Boolean).join(', ');
                                                            })()}</strong></span>
                                                            {(() => {
                                                                const order = (chore.rotation_order || []).filter(uid => houseMembers.some(m => m.id === uid));
                                                                const queue = order.length > 0 ? order : houseMembers.map(m => m.id);
                                                                const primaryId = chore.assigned_to || (queue.length > 0 ? queue[0] : null);
                                                                const currentIndex = queue.indexOf(primaryId);
                                                                const count = chore.rotation_count || 1;
                                                                if (currentIndex !== -1 && queue.length > count) {
                                                                    const nextIndex = (currentIndex + count) % queue.length;
                                                                    const nextIds = [];
                                                                    for (let i = 0; i < count; i++) {
                                                                        const idx = (nextIndex + i) % queue.length;
                                                                        if (!nextIds.includes(queue[idx])) {
                                                                            nextIds.push(queue[idx]);
                                                                        }
                                                                    }
                                                                    const nextNames = nextIds.map(uid => houseMembers.find(m => m.id === uid)?.name).filter(Boolean).join(', ');
                                                                    return (
                                                                        <span>➔ Next: <strong>{nextNames}</strong></span>
                                                                    );
                                                                }
                                                                return null;
                                                            })()}
                                                        </>
                                                    ) : (
                                                        <span>
                                                            Assignees: <strong>{(() => {
                                                                if (Array.isArray(chore.rotation_order) && chore.rotation_order.length > 0) {
                                                                    return chore.rotation_order
                                                                        .map(uid => houseMembers.find(m => m.id === uid)?.name)
                                                                        .filter(Boolean)
                                                                        .join(', ');
                                                                }
                                                                return assignee ? assignee.name : 'Anyone';
                                                            })()}</strong>
                                                        </span>
                                                    )}
                                                    <span className="badge badge-secondary" style={{ fontSize: '0.65rem' }}>
                                                        {chore.rotation_type === 'rotating'
                                                            ? `${chore.frequency} rotation`
                                                            : `fixed - ${chore.frequency}`
                                                        }
                                                    </span>

                                                    {/* Rating approval badges */}
                                                    {isClaimedByMe && (
                                                        <span className="badge" style={{ background: 'rgba(234, 179, 8, 0.15)', color: '#eab308' }}>
                                                            ⌛ Pending Approval by Roommates
                                                        </span>
                                                    )}
                                                    {isClaimedByOther && (
                                                        <span className="badge" style={{ background: 'rgba(168, 85, 247, 0.15)', color: '#c084fc' }}>
                                                            ⌛ Needs Verification (Completed by {claimant ? claimant.name : 'Roommate'})
                                                        </span>
                                                    )}
                                                </small>
                                            </div>
                                        </div>

                                        {/* Action buttons (Skips / Swaps / Deletes) */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            {chore.due_date && !isOneOffCompleted && (
                                                <span className="badge badge-primary">
                                                    Due: {new Date(chore.due_date).toLocaleDateString()}
                                                </span>
                                            )}

                                            {!isOneOffCompleted && !chore.is_pending_approval && chore.rotation_type === 'rotating' && houseMembers.length > 1 && (
                                                <>
                                                    <button
                                                        onClick={() => handleSkipOpen(chore)}
                                                        className="btn btn-secondary btn-small"
                                                        title="Skip & Assign turn to roommate"
                                                        style={{ padding: '6px' }}
                                                    >
                                                        <FastForward size={14} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleSwapOpen(chore)}
                                                        className="btn btn-secondary btn-small"
                                                        title="Swap turn with another roommate"
                                                        style={{ padding: '6px' }}
                                                    >
                                                        <ArrowRightLeft size={14} />
                                                    </button>
                                                </>
                                            )}

                                            <button
                                                onClick={() => handleDeleteChore(chore.id)}
                                                style={{ background: 'none', border: 'none', color: '#ef4444', padding: '6px', cursor: 'pointer' }}
                                                title="Delete Chore"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Star Rating Review block inside list for other roommates */}
                                    {isClaimedByOther && (
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', padding: '8px 12px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)', marginLeft: '32px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Rating: </span>
                                                <div style={{ display: 'flex', gap: '2px' }}>
                                                    {[1, 2, 3, 4, 5].map(star => {
                                                        const activeRating = starRatings[chore.id] || 5;
                                                        const isSelected = star <= activeRating;
                                                        return (
                                                            <button
                                                                key={star}
                                                                type="button"
                                                                onClick={() => handleSelectStar(chore.id, star)}
                                                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                                                            >
                                                                <Star
                                                                    size={14}
                                                                    fill={isSelected ? '#fbbf24' : 'none'}
                                                                    color={isSelected ? '#fbbf24' : 'var(--text-muted)'}
                                                                />
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>

                                            <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto' }}>
                                                <button onClick={() => handleApprovePress(chore)} className="btn btn-primary btn-small" style={{ padding: '4px 8px', fontSize: '0.75rem' }}>Approve</button>
                                                <button onClick={() => handleRejectPress(chore)} className="btn btn-secondary btn-small" style={{ padding: '4px 8px', fontSize: '0.75rem', color: '#ef4444' }}>Reject</button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Swap Modal */}
            {showSwapModal && selectedChoreToSwap && (
                <div className="modal-overlay">
                    <div className="glass-card modal-content" style={{ maxWidth: '400px' }}>
                        <div className="modal-header">
                            <h3>Swap Assignment Turn</h3>
                            <button onClick={() => { setShowSwapModal(false); setSelectedChoreToSwap(null); }} className="modal-close-btn">✕</button>
                        </div>
                        <form onSubmit={handleSwapSubmit} className="spaced-y-4">
                            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                Re-assign this turn of <strong>{selectedChoreToSwap.name}</strong> to:
                            </p>
                            <div className="form-group">
                                <select
                                    value={swapAssignee}
                                    onChange={(e) => setSwapAssignee(e.target.value)}
                                    className="input-field"
                                    required
                                >
                                    <option value="">Select Roommate...</option>
                                    {houseMembers.filter(m => m.id !== selectedChoreToSwap.assigned_to).map(member => (
                                        <option key={member.id} value={member.id}>{member.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex gap-4">
                                <button type="submit" className="btn btn-primary" style={{ flexGrow: 1 }}>Confirm Swap</button>
                                <button type="button" onClick={() => { setShowSwapModal(false); setSelectedChoreToSwap(null); }} className="btn btn-secondary">Cancel</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Skip Modal */}
            {showSkipModal && selectedChoreToSkip && (
                <div className="modal-overlay">
                    <div className="glass-card modal-content" style={{ maxWidth: '400px' }}>
                        <div className="modal-header">
                            <h3>Skip & Re-Assign Turn</h3>
                            <button onClick={() => { setShowSkipModal(false); setSelectedChoreToSkip(null); setSkipAssignee(''); }} className="modal-close-btn">✕</button>
                        </div>
                        <form onSubmit={handleSkipSubmit} className="spaced-y-4">
                            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                Skip this turn of <strong>{selectedChoreToSkip.name}</strong> and assign to:
                            </p>
                            <div className="form-group">
                                <select
                                    value={skipAssignee}
                                    onChange={(e) => setSkipAssignee(e.target.value)}
                                    className="input-field"
                                    required
                                >
                                    <option value="">Select Roommate...</option>
                                    {houseMembers.filter(m => m.id !== selectedChoreToSkip.assigned_to).map(member => (
                                        <option key={member.id} value={member.id}>{member.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex gap-4">
                                <button type="submit" className="btn btn-primary" style={{ flexGrow: 1 }}>Confirm Skip</button>
                                <button type="button" onClick={() => { setShowSkipModal(false); setSelectedChoreToSkip(null); setSkipAssignee(''); }} className="btn btn-secondary">Cancel</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* History Log Drawer */}
            {showHistoryDrawer && (
                <div className="modal-overlay" style={{ justifyContent: 'flex-end', alignItems: 'stretch' }}>
                    <div className="glass-card" style={{ width: '420px', borderRadius: 0, padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px' }}>
                            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <History size={20} className="text-purple" />
                                Action History Log
                            </h3>
                            <button onClick={() => setShowHistoryDrawer(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
                        </div>

                        <div className="spaced-y-4" style={{ flexGrow: 1, overflowY: 'auto' }}>
                            {choreHistory.length === 0 ? (
                                <p className="helper-text font-italic">No history records logged yet.</p>
                            ) : (
                                choreHistory.map((item, idx) => {
                                    const user = houseMembers.find(m => m.id === item.completed_by);
                                    const approver = houseMembers.find(m => m.id === item.approved_by);
                                    let typeBadg = 'complete';
                                    let badgeColor = 'rgba(34, 197, 94, 0.1)';
                                    let textCol = '#22c55e';

                                    if (item.action_type === 'skip') {
                                        typeBadg = 'skip';
                                        badgeColor = 'rgba(249, 115, 22, 0.1)';
                                        textCol = '#f97316';
                                    } else if (item.action_type === 'swap') {
                                        typeBadg = 'swap';
                                        badgeColor = 'rgba(6, 182, 212, 0.1)';
                                        textCol = '#06b6d4';
                                    }

                                    return (
                                        <div key={idx} style={{ padding: '10px', borderRadius: '6px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', fontSize: '0.8rem' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                                                <strong>{item.chore_name}</strong>
                                                <span style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px', background: badgeColor, color: textCol, textTransform: 'uppercase', fontWeight: 'bold' }}>
                                                    {typeBadg}
                                                </span>
                                            </div>
                                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                                <span>Worker: <strong>{user ? user.name : 'Unknown'}</strong></span>
                                                {item.rating && (
                                                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        Stars:
                                                        <div style={{ display: 'flex', gap: '1px' }}>
                                                            {[1, 2, 3, 4, 5].map(st => (
                                                                <Star
                                                                    key={st}
                                                                    size={10}
                                                                    fill={st <= item.rating ? '#fbbf24' : 'none'}
                                                                    color={st <= item.rating ? '#fbbf24' : 'var(--text-muted)'}
                                                                />
                                                            ))}
                                                        </div>
                                                        {approver && <span style={{ color: 'var(--text-muted)' }}> (approved by {approver.name})</span>}
                                                    </span>
                                                )}
                                            </div>
                                            <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginTop: '4px' }}>
                                                {new Date(item.created_at).toLocaleString()}
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Add Chore Modal */}
            {showAddModal && (
                <div className="modal-overlay">
                    <div className="glass-card modal-content">
                        <div className="modal-header">
                            <h3>Add New House Chore</h3>
                            <button onClick={() => setShowAddModal(false)} className="modal-close-btn">✕</button>
                        </div>

                        <form onSubmit={handleAddSubmit} className="spaced-y-4">
                            {submitError && <div className="feedback-alert error-alert">{submitError}</div>}

                            <div className="form-group">
                                <label className="form-label" htmlFor="chore-name">Chore Name</label>
                                <input
                                    id="chore-name"
                                    type="text"
                                    className="input-field"
                                    placeholder="e.g. Wash Dishes, Take Out Trash"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    required
                                />
                            </div>

                            <div className="form-group">
                                <label className="form-label" htmlFor="chore-desc">Details / Instructions (Optional)</label>
                                <textarea
                                    id="chore-desc"
                                    className="input-field"
                                    placeholder="e.g. Wipe down counters and load dishwasher"
                                    value={desc}
                                    onChange={(e) => setDesc(e.target.value)}
                                    style={{ minHeight: '60px', resize: 'vertical' }}
                                />
                            </div>

                            {/* Rotation Mode Selector */}
                            <div className="form-group">
                                <label className="form-label">Assignment Method</label>
                                <div style={{ display: 'flex', gap: '16px', marginTop: '4px' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                                        <input
                                            type="radio"
                                            name="assignMethod"
                                            checked={rotationType === 'fixed'}
                                            onChange={() => setRotationType('fixed')}
                                        />
                                        <span>Fixed Assignee</span>
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                                        <input
                                            type="radio"
                                            name="assignMethod"
                                            checked={rotationType === 'rotating'}
                                            onChange={() => setRotationType('rotating')}
                                        />
                                        <span>Round-Robin Rotation</span>
                                    </label>
                                </div>
                            </div>

                            {rotationType === 'fixed' ? (
                                houseMembers.length > 1 ? (
                                    <div className="form-group">
                                        <label className="form-label">Assign to Roommates (Check to assign; select one or more)</label>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)' }}>
                                            {houseMembers.map(member => {
                                                const included = rotationQueue.includes(member.id);
                                                return (
                                                    <label key={member.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={included}
                                                            onChange={() => handleToggleQueueMember(member.id)}
                                                        />
                                                        <span style={{ fontSize: '0.85rem' }}>{member.name}</span>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="form-group">
                                        <label className="form-label" htmlFor="chore-assignee">Assigned Roommate</label>
                                        <select
                                            id="chore-assignee"
                                            className="input-field"
                                            value={assignedTo}
                                            onChange={(e) => setAssignedTo(e.target.value)}
                                        >
                                            <option value="">Unassigned (Anyone)</option>
                                            {houseMembers.map(member => (
                                                <option key={member.id} value={member.id}>
                                                    {member.name} {member.id === profile.id ? '(You)' : ''}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                )
                            ) : (
                                <div className="form-group">
                                    <label className="form-label" htmlFor="chore-assignee">Initial Assignee</label>
                                    <select
                                        id="chore-assignee"
                                        className="input-field"
                                        value={assignedTo}
                                        onChange={(e) => setAssignedTo(e.target.value)}
                                    >
                                        <option value="">Unassigned (Anyone)</option>
                                        {houseMembers.map(member => (
                                            <option key={member.id} value={member.id}>
                                                {member.name} {member.id === profile.id ? '(You)' : ''}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {rotationType === 'rotating' && houseMembers.length > 1 && (
                                <>
                                    <div className="form-group">
                                        <label className="form-label" htmlFor="chore-rotation-count">Concurrent Assignees (1 to 5)</label>
                                        <select
                                            id="chore-rotation-count"
                                            className="input-field"
                                            value={rotationCount}
                                            onChange={(e) => setRotationCount(parseInt(e.target.value))}
                                        >
                                            {[1, 2, 3, 4, 5].map(val => (
                                                <option key={val} value={val}>{val}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                            <label className="form-label" style={{ marginBottom: 0 }}>Rotation Order (Determines run sequence)</label>
                                            {rotationQueue.length > 0 && (
                                                <button
                                                    type="button"
                                                    className="btn btn-secondary btn-small"
                                                    onClick={() => setRotationQueue([])}
                                                    style={{ padding: '2px 8px', fontSize: '0.75rem', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)', height: 'auto', minHeight: 'unset' }}
                                                >
                                                    Reset Order
                                                </button>
                                            )}
                                        </div>

                                        {/* Current Queue Sequence Display */}
                                        <div style={{ padding: '12px', background: 'rgba(255,255,255,0.01)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', marginBottom: '10px' }}>
                                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '8px' }}>
                                                Active Rotation Sequence:
                                            </span>
                                            {rotationQueue.length === 0 ? (
                                                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic', margin: 0 }}>
                                                    Queue is empty. Select roommates below to build run order.
                                                </p>
                                            ) : (
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                                    {rotationQueue.map((memberId, index) => {
                                                        const member = houseMembers.find(m => m.id === memberId);
                                                        if (!member) return null;
                                                        return (
                                                            <div
                                                                key={memberId}
                                                                style={{
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '6px',
                                                                    padding: '4px 10px',
                                                                    background: 'rgba(168, 85, 247, 0.15)',
                                                                    border: '1px solid rgba(168, 85, 247, 0.3)',
                                                                    borderRadius: '20px',
                                                                    fontSize: '0.8rem'
                                                                }}
                                                            >
                                                                <span style={{ fontWeight: 'bold', color: '#c084fc' }}>{index + 1}.</span>
                                                                <span>{member.name}</span>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setRotationQueue(rotationQueue.filter(id => id !== memberId))}
                                                                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0 2px', fontSize: '0.9rem', lineHeight: 1 }}
                                                                >
                                                                    ✕
                                                                </button>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>

                                        {/* Available Roommates to Append */}
                                        <div style={{ padding: '10px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '8px' }}>
                                                Select Roommates to Add (Click in order of rotation):
                                            </span>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                                {houseMembers.map(member => {
                                                    const isSelected = rotationQueue.includes(member.id);
                                                    return (
                                                        <button
                                                            key={member.id}
                                                            type="button"
                                                            onClick={() => {
                                                                if (!isSelected) {
                                                                    setRotationQueue([...rotationQueue, member.id]);
                                                                }
                                                            }}
                                                            disabled={isSelected}
                                                            className="btn btn-secondary"
                                                            style={{
                                                                padding: '6px 12px',
                                                                fontSize: '0.8rem',
                                                                opacity: isSelected ? 0.4 : 1,
                                                                cursor: isSelected ? 'not-allowed' : 'pointer',
                                                                background: isSelected ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.07)',
                                                                borderColor: 'rgba(255,255,255,0.1)'
                                                            }}
                                                        >
                                                            + {member.name}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                </>
                            )}

                            <div className="form-group">
                                <label className="form-label" htmlFor="chore-freq">Frequency</label>
                                <select
                                    id="chore-freq"
                                    className="input-field"
                                    value={frequency}
                                    onChange={(e) => setFrequency(e.target.value)}
                                >
                                    <option value="one-off">One-off Task</option>
                                    <option value="daily">Daily Rotation</option>
                                    <option value="weekly">Weekly Rotation</option>
                                    <option value="monthly">Monthly Rotation</option>
                                </select>
                            </div>

                            <div className="form-group">
                                <label className="form-label" htmlFor="chore-due">Due Date</label>
                                <input
                                    id="chore-due"
                                    type="date"
                                    className="input-field"
                                    value={dueDate}
                                    onChange={(e) => setDueDate(e.target.value)}
                                />
                            </div>

                            <div className="flex gap-4" style={{ marginTop: '20px' }}>
                                <button type="submit" className="btn btn-primary" style={{ flexGrow: 1 }} disabled={loading}>
                                    Schedule Chore
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowAddModal(false)}
                                    className="btn btn-secondary"
                                    disabled={loading}
                                >
                                    Cancel
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
