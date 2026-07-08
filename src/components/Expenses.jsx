import React, { useState, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { DollarSign, Plus, CheckCircle, HelpCircle, UserCheck } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

export default function Expenses({ profile, houseId, houseMembers, expenses }) {
    const queryClient = useQueryClient();
    const [showAddModal, setShowAddModal] = useState(false);

    // Form State
    const [desc, setDesc] = useState('');
    const [amount, setAmount] = useState('');
    const [payerId, setPayerId] = useState(profile.id);
    const [submitError, setSubmitError] = useState('');
    const [loading, setLoading] = useState(false);

    // 1. Calculate Balance sheet (who owes what)
    // For each user, calculate how much they are owed (positive) or owe (negative) in net.
    const balanceSheet = useMemo(() => {
        const balances = {};

        // Init all members with 0
        houseMembers.forEach(m => {
            balances[m.id] = { id: m.id, name: m.name, netBalance: 0 };
        });

        expenses.forEach(exp => {
            const amt = Number(exp.amount || 0);
            const splits = exp.split_details || [];
            const unsettledSplits = splits.filter(s => !s.is_settled);

            // Distribute amount spent to payer
            // For each unsettled split where user is involved, adjust net balance
            unsettledSplits.forEach(split => {
                if (exp.payer_id === split.user_id) {
                    // If the payer is the one split, they don't owe themselves,
                    // but they paid for this chunk.
                    // Wait, if Payer paid $60 and splits are $20 each for A, B, C (including Payer).
                    // Then B owes Payer $20, C owes Payer $20.
                    // In the split, B has split $20 (unsettled), C has split $20 (unsettled).
                    // So B gains -20, C gains -20, and Payer gains +40.
                } else {
                    // Non-payer owes the split amount:
                    if (balances[split.user_id]) {
                        balances[split.user_id].netBalance -= Number(split.amount);
                    }
                    // Payer is owed this amount:
                    if (balances[exp.payer_id]) {
                        balances[exp.payer_id].netBalance += Number(split.amount);
                    }
                }
            });
        });

        return Object.values(balances);
    }, [expenses, houseMembers]);

    // 2. Mutation for adding an expense
    const appendExpenseMutation = useMutation({
        mutationFn: async (newExp) => {
            const { data, error } = await supabase
                .from('expenses')
                .insert([newExp])
                .select();
            if (error) throw error;
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries(['expenses']);
            setShowAddModal(false);
            setDesc('');
            setAmount('');
            setPayerId(profile.id);
        }
    });

    // 3. Mutation for settling a specific split
    const settleSplitMutation = useMutation({
        mutationFn: async ({ expenseId, userId }) => {
            // Get the current expense record
            const { data: exp, error: fetchErr } = await supabase
                .from('expenses')
                .select()
                .eq('id', expenseId)
                .single();

            if (fetchErr) throw fetchErr;

            // Update that user's split detail
            const updatedSplits = (exp.split_details || []).map(split => {
                if (split.user_id === userId) {
                    return { ...split, is_settled: true };
                }
                return split;
            });

            // Update row back into Supabase
            const { data, error: updateErr } = await supabase
                .from('expenses')
                .update({ split_details: updatedSplits })
                .eq('id', expenseId)
                .select();

            if (updateErr) throw updateErr;
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries(['expenses']);
        }
    });

    const handleAddSubmit = async (e) => {
        e.preventDefault();
        setSubmitError('');

        const amtNumber = Number(amount);
        if (!desc.trim()) {
            setSubmitError('Please enter a description.');
            return;
        }
        if (isNaN(amtNumber) || amtNumber <= 0) {
            setSubmitError('Please enter a valid amount greater than 0.');
            return;
        }

        setLoading(true);

        // Compute splits: split equally among all members
        const shareAmt = Number((amtNumber / houseMembers.length).toFixed(2));
        const splits = houseMembers.map((member, idx) => {
            // Adjust rounding discrepancy to the last roommate in list
            let finalShare = shareAmt;
            if (idx === houseMembers.length - 1) {
                const totalCalculated = shareAmt * houseMembers.length;
                const diff = amtNumber - totalCalculated;
                finalShare = Number((shareAmt + diff).toFixed(2));
            }

            return {
                user_id: member.id,
                amount: finalShare,
                is_settled: member.id === payerId // Payer is already "settled" for their own share
            };
        });

        try {
            await appendExpenseMutation.mutateAsync({
                house_id: houseId,
                payer_id: payerId,
                description: desc,
                amount: amtNumber,
                split_details: splits
            });
        } catch (err) {
            setSubmitError(err.message || 'Error occurred while saving expense.');
        } finally {
            setLoading(false);
        }
    };

    const handleSettleClick = async (expenseId, userId) => {
        try {
            await settleSplitMutation.mutateAsync({ expenseId, userId });
        } catch (err) {
            alert('Failed to settle split: ' + err.message);
        }
    };

    return (
        <div>
            <div className="section-header">
                <div>
                    <h2>Expense Tracker</h2>
                    <p className="text-secondary">Keep track of shared bills and check net roommate dues.</p>
                </div>
                <button onClick={() => setShowAddModal(true)} className="btn btn-primary">
                    <Plus size={18} /> Add Bill
                </button>
            </div>

            {/* Balance Summary Header Cards */}
            <div className="stats-grid" style={{ marginBottom: '24px' }}>
                {balanceSheet.map(roommate => {
                    const isUser = roommate.id === profile.id;
                    const statusClass = roommate.netBalance > 0
                        ? 'success-bg'
                        : roommate.netBalance < 0
                            ? 'warning-bg'
                            : 'purple-bg';

                    return (
                        <div key={roommate.id} className="stat-card glass-card">
                            <div className={`stat-icon ${statusClass}`}>
                                <UserCheck size={20} />
                            </div>
                            <div className="stat-info">
                                <span className="stat-value">
                                    {roommate.netBalance > 0 ? '+' : ''}${roommate.netBalance.toFixed(2)}
                                </span>
                                <span className="stat-label">
                                    {roommate.name} {isUser ? '(You)' : ''}
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Expenses History Table */}
            <div className="glass-card">
                <h3 style={{ marginBottom: '16px' }}>Shared Expenses Log</h3>

                {expenses.length === 0 ? (
                    <p className="helper-text font-italic">No expenses filed yet.</p>
                ) : (
                    <div className="table-wrapper">
                        <table className="app-table">
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Description</th>
                                    <th>Amt Paid</th>
                                    <th>Paid By</th>
                                    <th>Splits status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {expenses.map(exp => {
                                    const payer = houseMembers.find(m => m.id === exp.payer_id);
                                    const splits = exp.split_details || [];

                                    return (
                                        <tr key={exp.id}>
                                            <td>{new Date(exp.created_at).toLocaleDateString()}</td>
                                            <td><strong>{exp.description}</strong></td>
                                            <td>${exp.amount.toFixed(2)}</td>
                                            <td>{payer ? payer.name : 'Unknown'}</td>
                                            <td>
                                                <div className="flex flex-col gap-2">
                                                    {splits.map(split => {
                                                        const recipient = houseMembers.find(m => m.id === split.user_id);
                                                        if (!recipient) return null;

                                                        // If this split belongs to the payer, it's auto-settled
                                                        if (split.user_id === exp.payer_id) return null;

                                                        return (
                                                            <div key={split.user_id} className="flex items-center justify-between gap-4" style={{ fontSize: '0.85rem' }}>
                                                                <span className={split.is_settled ? 'text-muted line-through' : ''}>
                                                                    {recipient.name}: ${split.amount.toFixed(2)}
                                                                </span>

                                                                {split.is_settled ? (
                                                                    <span className="badge badge-success flex items-center gap-1" style={{ padding: '2px 8px', fontSize: '0.7rem' }}>
                                                                        Settled
                                                                    </span>
                                                                ) : (
                                                                    exp.payer_id === profile.id || split.user_id === profile.id ? (
                                                                        <button
                                                                            onClick={() => handleSettleClick(exp.id, split.user_id)}
                                                                            className="btn btn-secondary btn-small"
                                                                            style={{ padding: '2px 8px', fontSize: '0.7rem' }}
                                                                        >
                                                                            Settle Up
                                                                        </button>
                                                                    ) : (
                                                                        <span className="badge badge-error flex items-center gap-1" style={{ padding: '2px 8px', fontSize: '0.7rem' }}>
                                                                            Pending
                                                                        </span>
                                                                    )
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Add Expense Modal Overlay */}
            {showAddModal && (
                <div className="modal-overlay">
                    <div className="glass-card modal-content">
                        <div className="modal-header">
                            <h3>Create Shared Bill</h3>
                            <button onClick={() => setShowAddModal(false)} className="modal-close-btn">✕</button>
                        </div>

                        <form onSubmit={handleAddSubmit} className="spaced-y-4">
                            {submitError && <div className="feedback-alert error-alert">{submitError}</div>}

                            <div className="form-group">
                                <label className="form-label" htmlFor="exp-desc">Description</label>
                                <input
                                    id="exp-desc"
                                    type="text"
                                    className="input-field"
                                    placeholder="e.g. WiFi Bill, Electricity, Rent"
                                    value={desc}
                                    onChange={(e) => setDesc(e.target.value)}
                                    required
                                />
                            </div>

                            <div className="form-group">
                                <label className="form-label" htmlFor="exp-amount">Amount ($)</label>
                                <input
                                    id="exp-amount"
                                    type="number"
                                    step="0.01"
                                    min="0.01"
                                    className="input-field"
                                    placeholder="0.00"
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    required
                                />
                            </div>

                            <div className="form-group">
                                <label className="form-label" htmlFor="exp-payer">Who Paid?</label>
                                <select
                                    id="exp-payer"
                                    className="input-field"
                                    value={payerId}
                                    onChange={(e) => setPayerId(e.target.value)}
                                >
                                    {houseMembers.map(member => (
                                        <option key={member.id} value={member.id}>
                                            {member.name} {member.id === profile.id ? '(You)' : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <p className="helper-text text-left">
                                * Note: This expense will be split equally among all {houseMembers.length} house roommates.
                            </p>

                            <div className="flex gap-4" style={{ marginTop: '20px' }}>
                                <button type="submit" className="btn btn-primary" style={{ flexGrow: 1 }} disabled={loading}>
                                    Save Expense
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
