import React, { useState } from 'react';
import { supabase } from '../supabaseClient';
import { CheckSquare, Plus, RotateCw, Calendar, User, Check, Square } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

export default function Chores({ profile, houseId, houseMembers, chores }) {
    const queryClient = useQueryClient();
    const [showAddModal, setShowAddModal] = useState(false);

    // Form State
    const [name, setName] = useState('');
    const [desc, setDesc] = useState('');
    const [assignedTo, setAssignedTo] = useState(profile.id);
    const [frequency, setFrequency] = useState('one-off');
    const [dueDate, setDueDate] = useState('');
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
        }
    });

    // 2. Mutation for completing a chore
    const completeChoreMutation = useMutation({
        mutationFn: async ({ choreId, currentAssigneeId, frequency, currentDueDate }) => {
            let updateFields = {
                last_completed_at: new Date().toISOString(),
                last_completed_by: profile.id
            };

            if (frequency !== 'one-off') {
                // Compute next due date based on frequency
                const nextDueDate = new Date(currentDueDate || new Date());
                if (frequency === 'daily') {
                    nextDueDate.setDate(nextDueDate.getDate() + 1);
                } else if (frequency === 'weekly') {
                    nextDueDate.setDate(nextDueDate.getDate() + 7);
                }
                updateFields.due_date = nextDueDate.toISOString();

                // Rotate assignee (select the next member in the array)
                if (houseMembers.length > 1) {
                    const currentIndex = houseMembers.findIndex(m => m.id === currentAssigneeId);
                    const nextIndex = (currentIndex + 1) % houseMembers.length;
                    updateFields.assigned_to = houseMembers[nextIndex].id;
                }
            } else {
                // One-off chore: clear assignee so it's resolved or keep it, let's keep it but just count as completed.
            }

            const { data, error } = await supabase
                .from('chores')
                .update(updateFields)
                .eq('id', choreId)
                .select();
            if (error) throw error;
            return data;
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
                due_date: dueDate ? new Date(dueDate).toISOString() : null
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
                currentDueDate: chore.due_date
            });
        } catch (err) {
            alert('Failed to complete chore: ' + err.message);
        }
    };

    return (
        <div>
            <div className="section-header">
                <div>
                    <h2>Chore Tracker</h2>
                    <p className="text-secondary">Keep your shared home clean. Recurring tasks will rotate assignees automatically!</p>
                </div>
                <button onClick={() => setShowAddModal(true)} className="btn btn-primary">
                    <Plus size={18} /> Add Chore
                </button>
            </div>

            <div className="glass-card">
                <h3 style={{ marginBottom: '16px' }}>Current House Chores</h3>

                {chores.length === 0 ? (
                    <p className="helper-text font-italic">No chores scheduled yet. Enjoy the clean space!</p>
                ) : (
                    <div className="list-container">
                        {chores.map(chore => {
                            const assignee = houseMembers.find(m => m.id === chore.assigned_to);
                            const isOneOffCompleted = chore.frequency === 'one-off' && chore.last_completed_at;
                            const isAssigneeMe = chore.assigned_to === profile.id;

                            return (
                                <div key={chore.id} className="list-item" style={{ opacity: isOneOffCompleted ? 0.6 : 1 }}>
                                    <div className="list-item-content">
                                        <button
                                            onClick={() => !isOneOffCompleted && handleCompleteChore(chore)}
                                            disabled={isOneOffCompleted}
                                            className={`list-item-checkbox ${isOneOffCompleted ? 'checked' : ''}`}
                                        >
                                            {isOneOffCompleted && <Check size={14} />}
                                        </button>
                                        <div>
                                            <p className={`list-item-title ${isOneOffCompleted ? 'completed' : ''}`}>
                                                {chore.name}
                                            </p>
                                            <small className="text-muted">
                                                {chore.description && <span>{chore.description} • </span>}
                                                <span>Assigned: <strong>{assignee ? assignee.name : 'Anyone'}</strong></span>
                                                {chore.frequency !== 'one-off' && (
                                                    <span className="badge badge-secondary" style={{ marginLeft: '8px', fontSize: '0.65rem', padding: '2px 6px' }}>
                                                        <RotateCw size={10} style={{ marginRight: '3px' }} /> {chore.frequency} Rotation
                                                    </span>
                                                )}
                                            </small>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        {chore.due_date && !isOneOffCompleted && (
                                            <span className="badge badge-primary">
                                                Due: {new Date(chore.due_date).toLocaleDateString()}
                                            </span>
                                        )}

                                        {chore.last_completed_at && (
                                            <small className="text-muted" style={{ fontSize: '0.75rem' }}>
                                                Done {new Date(chore.last_completed_at).toLocaleDateString()}
                                            </small>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Add Chore Modal Overlay */}
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
                                    style={{ minHeight: '80px', resize: 'vertical' }}
                                />
                            </div>

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
