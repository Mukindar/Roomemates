import React, { useMemo } from 'react';
import { Home, DollarSign, CheckSquare, ShoppingCart, Users, Clipboard } from 'lucide-react';

export default function Dashboard({ profile, house, houseMembers, expenses, chores, shoppingItems, setActiveTab }) {
    // 1. Calculate financial statistics
    const finances = useMemo(() => {
        let totalSpent = 0;
        let userOwes = 0;
        let userOwed = 0;

        expenses.forEach(exp => {
            totalSpent += Number(exp.amount || 0);

            const splitDetails = exp.split_details || [];
            const userSplit = splitDetails.find(s => s.user_id === profile.id);

            if (exp.payer_id === profile.id) {
                // User paid: count what OTHERS owe the user
                const otherSplits = splitDetails.filter(s => s.user_id !== profile.id && !s.is_settled);
                otherSplits.forEach(s => {
                    userOwed += Number(s.amount || 0);
                });
            } else if (userSplit && !userSplit.is_settled) {
                // Someone else paid, and user is in split: user owes this amount
                userOwes += Number(userSplit.amount || 0);
            }
        });

        return { totalSpent, userOwes, userOwed };
    }, [expenses, profile.id]);

    // 2. Count active chores
    const pendingChores = useMemo(() => {
        return chores.filter(c => !c.last_completed_at || c.frequency !== 'one-off');
    }, [chores]);

    // 3. Count shopping items
    const activeShoppingItems = useMemo(() => {
        return shoppingItems.filter(i => !i.is_purchased);
    }, [shoppingItems]);

    return (
        <div>
            <div className="welcome-banner">
                <h1>Welcome Back, {profile.name}!</h1>
                <p>Here is what's happening at <strong>{house?.name || 'your household'}</strong> today.</p>
            </div>

            {/* Stats Cards */}
            <div className="stats-grid">
                <div className="stat-card glass-card">
                    <div className="stat-icon purple-bg">
                        <DollarSign size={24} />
                    </div>
                    <div className="stat-info">
                        <span className="stat-value">${finances.userOwed.toFixed(2)}</span>
                        <span className="stat-label">Owed to You</span>
                    </div>
                </div>

                <div className="stat-card glass-card">
                    <div className="stat-icon warning-bg">
                        <DollarSign size={24} />
                    </div>
                    <div className="stat-info">
                        <span className="stat-value">${finances.userOwes.toFixed(2)}</span>
                        <span className="stat-label">You Owe</span>
                    </div>
                </div>

                <div className="stat-card glass-card">
                    <div className="stat-icon success-bg">
                        <CheckSquare size={24} />
                    </div>
                    <div className="stat-info">
                        <span className="stat-value">{pendingChores.filter(c => c.assigned_to === profile.id).length}</span>
                        <span className="stat-label">Your Chores</span>
                    </div>
                </div>

                <div className="stat-card glass-card">
                    <div className="stat-icon cyan-bg">
                        <ShoppingCart size={24} />
                    </div>
                    <div className="stat-info">
                        <span className="stat-value">{activeShoppingItems.length}</span>
                        <span className="stat-label">Shopping Items</span>
                    </div>
                </div>
            </div>

            {/* Main Split Grid */}
            <div className="dashboard-sections">
                {/* Left Side: Recent Chores & Shopping */}
                <div className="dash-main">
                    {/* Chore Overview */}
                    <div className="glass-card module-card">
                        <div className="module-header">
                            <div className="module-title">
                                <CheckSquare size={20} className="text-purple" />
                                <h3>Chore Board Highlight</h3>
                            </div>
                            <button onClick={() => setActiveTab('chores')} className="btn btn-secondary btn-small">
                                View All Chores
                            </button>
                        </div>

                        <div className="list-container">
                            {pendingChores.length === 0 ? (
                                <p className="helper-text font-italic">No pending chores. Nice work!</p>
                            ) : (
                                pendingChores.slice(0, 3).map(chore => {
                                    const assignee = houseMembers.find(m => m.id === chore.assigned_to);
                                    return (
                                        <div key={chore.id} className="list-item">
                                            <div className="list-item-content">
                                                <Clipboard size={16} className="text-muted" />
                                                <div>
                                                    <p className="list-item-title">{chore.name}</p>
                                                    <small className="text-muted">
                                                        Assigned to: {assignee ? assignee.name : 'Unassigned'} • Freeq: {chore.frequency}
                                                    </small>
                                                </div>
                                            </div>
                                            {chore.due_date && (
                                                <span className="badge badge-primary">
                                                    Due: {new Date(chore.due_date).toLocaleDateString()}
                                                </span>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>

                    {/* Grocery Overview */}
                    <div className="glass-card module-card">
                        <div className="module-header">
                            <div className="module-title">
                                <ShoppingCart size={20} className="text-cyan" />
                                <h3>Active Groceries Needs</h3>
                            </div>
                            <button onClick={() => setActiveTab('shopping')} className="btn btn-secondary btn-small">
                                View Shopping List
                            </button>
                        </div>

                        <div className="list-container">
                            {activeShoppingItems.length === 0 ? (
                                <p className="helper-text font-italic">Shopping list is currently empty.</p>
                            ) : (
                                activeShoppingItems.slice(0, 3).map(item => {
                                    const adder = houseMembers.find(m => m.id === item.added_by);
                                    return (
                                        <div key={item.id} className="list-item">
                                            <div className="list-item-content">
                                                <span className="list-item-checkbox"></span>
                                                <div>
                                                    <p className="list-item-title">{item.name}</p>
                                                    <small className="text-muted">
                                                        Qty: {item.quantity} • Added by {adder ? adder.name : 'Unknown'}
                                                    </small>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>

                {/* Right Side: Flatmates List */}
                <div className="dash-side">
                    <div className="glass-card module-card">
                        <div className="module-header">
                            <div className="module-title">
                                <Users size={20} className="text-cyan" />
                                <h3>Roommates ({houseMembers.length})</h3>
                            </div>
                        </div>

                        <div className="spaced-y-4">
                            {houseMembers.map(member => (
                                <div key={member.id} className="user-badge">
                                    <div className="user-avatar">
                                        {member.name.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="user-info">
                                        <span className="user-name">{member.name} {member.id === profile.id && '(You)'}</span>
                                        <span className="house-name-text">Joined {new Date(member.created_at).toLocaleDateString()}</span>
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
