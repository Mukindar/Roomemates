import React, { useState } from 'react';
import { supabase } from '../supabaseClient';
import { CheckSquare, Plus, RotateCw, Calendar, User, Check, Trash2, ArrowRightLeft, FastForward, History } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

export default function Chores({ profile, houseId, houseMembers, chores, choreHistory = [] }) {
    const queryClient = useQueryClient();
    const [showAddModal, setShowAddModal] = useState(false);
    const [showSwapModal, setShowSwapModal] = useState(false);
    const [selectedChoreToSwap, setSelectedChoreToSwap] = useState(null);
    const [swapAssignee, setSwapAssignee] = useState('');
    const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);

    // Form State
    const [name, setName] = useState('');
    const [desc, setDesc] = useState('');
    const [assignedTo, setAssignedTo] = useState(profile.id);
    const [frequency, setFrequency] = useState('one-off');
    const [dueDate, setDueDate] = useState('');
    const [rotationType, setRotationType] = useState('rotating'); // 'rotating' vs 'fixed'
    const [rotationQueue, setRotationQueue] = useState(houseMembers.map(m => m.id)); // Order of rotation

    const [submitError, setSubmitError] = useState('');
    const [loading, setLoading] = useState(false);

    // 1. Mutation for adding a chore
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
        }
    });

    // 2. Mutation for completing a chore
    const completeChoreMutation = useMutation({
        mutationFn: async ({ choreId, currentAssigneeId, frequency, currentDueDate, name }) => {
            let updateFields = {
                last_completed_at: new Date().toISOString(),
                last_completed_by: profile.id
            };

            let nextAssigneeId = currentAssigneeId;

            // Rotate assignee if recurring
            if (frequency !== 'one-off' && houseMembers.length > 1) {
                const targetChore = chores.find(c => c.id === choreId);
                const order = (targetChore?.rotation_order || []).filter(uid => houseMembers.some(m => m.id === uid));
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

            const { error } = await supabase
                .from('chores')
                .update(updateFields)
                .eq('id', choreId);
            if (error) throw error;

            // History log
            await supabase.from('chore_history').insert([{
                house_id: houseId,
                chore_id: choreId,
                chore_name: name,
                completed_by: profile.id,
                action_type: 'complete'
            }]);

            // Notification message
            if (nextAssigneeId !== currentAssigneeId) {
                await supabase.from('chore_notifications').insert([{
                    house_id: houseId,
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

    // 3. Mutation for skipping a turn
    const skipTurnMutation = useMutation({
        mutationFn: async ({ choreId, currentAssigneeId, name }) => {
            let nextAssigneeId = currentAssigneeId;
            const targetChore = chores.find(c => c.id === choreId);

            if (houseMembers.length > 1) {
                const order = (targetChore?.rotation_order || []).filter(uid => houseMembers.some(m => m.id === uid));
                const activeQueue = order.length > 0 ? order : houseMembers.map(m => m.id);
                const currentIndex = activeQueue.indexOf(currentAssigneeId);
                const nextIndex = currentIndex !== -1 ? (currentIndex + 1) % activeQueue.length : 0;
                nextAssigneeId = activeQueue[nextIndex];
            }

            const { error } = await supabase
                .from('chores')
                .update({ assigned_to: nextAssigneeId })
                .eq('id', choreId);
            if (error) throw error;

            // History log
            await supabase.from('chore_history').insert([{
                house_id: houseId,
                chore_id: choreId,
                chore_name: name,
                completed_by: profile.id,
                action_type: 'skip'
            }]);

            // Notification
            await supabase.from('chore_notifications').insert([{
                house_id: houseId,
                message: `${profile.name} skipped turn for "${name}". It has been passed to you!`,
                profile_id: nextAssigneeId
            }]);
        },
        onSuccess: () => {
            queryClient.invalidateQueries(['chores']);
            queryClient.invalidateQueries(['chore_history']);
            queryClient.invalidateQueries(['chore_notifications']);
        }
    });

    // 4. Mutation for swapping turns
    const swapTurnMutation = useMutation({
        mutationFn: async ({ choreId, targetRoommateId, name }) => {
            const { error } = await supabase
                .from('chores')
                .update({ assigned_to: targetRoommateId })
                .eq('id', choreId);
            if (error) throw error;

            // History log
            await supabase.from('chore_history').insert([{
                house_id: houseId,
                chore_id: choreId,
                chore_name: name,
                completed_by: profile.id,
                action_type: 'swap'
            }]);

            // Notification
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
        }
    });

    // 5. Mutation for deleting a chore
    const deleteChoreMutation = useMutation({
        mutationFn: async (choreId) => {
            const { error } = await supabase.from('chores').delete().eq('id', choreId);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries(['chores']);
        }
    });

    const handleAddSubmit = async (e) => {
        e.preventDefault();
        setSubmitError('');

        if (!name.trim()) {
            setSubmitError('Please enter a chore name.');
            return;
        }

        setLoading(true);

        try {
            await appendChoreMutation.mutateAsync({
                house_id: houseId,
                name,
                description: desc,
                assigned_to: assignedTo || null,
                frequency,
                due_date: dueDate ? new Date(dueDate).toISOString() : null,
                rotation_type: rotationType,
                rotation_order: rotationType === 'rotating' ? rotationQueue : []
            });
        } catch (err) {
            setSubmitError(err.message || 'Error occurred while saving chore.');
        } finally {
            setLoading(false);
        }
    };

    const handleCompleteChore = async (chore) => {
        try {
            await completeChoreMutation.mutateAsync({
                choreId: chore.id,
                currentAssigneeId: chore.assigned_to,
                frequency: chore.frequency,
                currentDueDate: chore.due_date,
                name: chore.name
            });
        } catch (err) {
            alert('Failed to complete chore: ' + err.message);
        }
    };

    const handleSkipChore = async (chore) => {
        if (!confirm(`Are you sure you want to skip turn for "${chore.name}"?`)) return;
        try {
            await skipTurnMutation.mutateAsync({
                choreId: chore.id,
                currentAssigneeId: chore.assigned_to,
                name: chore.name
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
                    <p className="text-secondary">Keep your shared flat running smoothly. Manage schedules and assign turns.</p>
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

            {/* List Chores */}
            <div className="glass-card">
                <h3 style={{ marginBottom: '16px' }}>Current Scheduling</h3>

                {chores.length === 0 ? (
                    <p className="helper-text font-italic">No chores scheduled yet. Add one above!</p>
                ) : (
                    <div className="list-container">
                        {chores.map(chore => {
                            const assignee = houseMembers.find(m => m.id === chore.assigned_to);
                            const isOneOffCompleted = chore.frequency === 'one-off' && chore.last_completed_at;

                            return (
                                <div key={chore.id} className="list-item" style={{ opacity: isOneOffCompleted ? 0.6 : 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div className="list-item-content">
                                        <button
                                            onClick={() => !isOneOffCompleted && handleCompleteChore(chore)}
                                            disabled={isOneOffCompleted}
                                            className={`list-item-checkbox ${isOneOffCompleted ? 'checked' : ''}`}
                                            title="Mark as Complete"
                                        >
                                            {isOneOffCompleted && <Check size={14} />}
                                        </button>
                                        <div>
                                            <p className={`list-item-title ${isOneOffCompleted ? 'completed' : ''}`}>
                                                {chore.name}
                                            </p>
                                            <small className="text-muted">
                                                {chore.description && <span>{chore.description} • </span>}
                                                <span>Assignee: <strong>{assignee ? assignee.name : 'Anyone'}</strong></span>
                                                <span className="badge badge-secondary" style={{ marginLeft: '8px', fontSize: '0.65rem' }}>
                                                    {chore.rotation_type === 'rotating'
                                                        ? `${chore.frequency} rotation`
                                                        : `fixed - ${chore.frequency}`
                                                    }
                                                </span>
                                            </small>
                                        </div>
                                    </div>

                                    {/* Action Buttons for Skips, Swaps, Delete */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        {chore.due_date && !isOneOffCompleted && (
                                            <span className="badge badge-primary">
                                                Due: {new Date(chore.due_date).toLocaleDateString()}
                                            </span>
                                        )}

                                        {!isOneOffCompleted && chore.rotation_type === 'rotating' && houseMembers.length > 1 && (
                                            <>
                                                <button
                                                    onClick={() => handleSkipChore(chore)}
                                                    className="btn btn-secondary btn-small"
                                                    title="Skip your turn (Pass to next)"
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
                                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                                                Action by: {user ? user.name : 'Unknown'}
                                            </div>
                                            <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginTop: '2px' }}>
                                                {new Date(item.completed_at).toLocaleString()}
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

                            <div className="form-group">
                                <label className="form-label" htmlFor="chore-assignee">
                                    {rotationType === 'rotating' ? 'Initial Assignee' : 'Assigned Roommate'}
                                </label>
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

                            {rotationType === 'rotating' && houseMembers.length > 1 && (
                                <div className="form-group">
                                    <label className="form-label">Rotation Order (Check to include in queue)</label>
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
