import React, { useState } from 'react';
import { Home, DollarSign, CheckSquare, ShoppingCart, LogOut, Copy, Check, Users } from 'lucide-react';

export default function Layout({
    profile,
    house,
    onSignOut,
    activeTab,
    setActiveTab,
    children
}) {
    const [copied, setCopied] = useState(false);

    const handleCopyCode = () => {
        if (!house?.invite_code) return;
        navigator.clipboard.writeText(house.invite_code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const navItems = [
        { id: 'dashboard', label: 'Dashboard', icon: <Home size={18} /> },
        { id: 'expenses', label: 'Expenses', icon: <DollarSign size={18} /> },
        { id: 'chores', label: 'Chores', icon: <CheckSquare size={18} /> },
        { id: 'shopping', label: 'Shopping List', icon: <ShoppingCart size={18} /> },
    ];

    return (
        <div className="app-layout">
            {/* Background Glows */}
            <div className="glow-spot-1"></div>
            <div className="glow-spot-2"></div>

            {/* Sidebar Panel */}
            <aside className="sidebar">
                <div className="sidebar-header">
                    <div className="logo-icon purple-gradient" style={{ width: '38px', height: '38px', borderRadius: '8px' }}>
                        <Users size={20} />
                    </div>
                    <span className="sidebar-logo">Roomemates</span>
                </div>

                {/* Invite Code Block */}
                {house && (
                    <div style={{ marginBottom: '24px' }}>
                        <span className="form-label" style={{ fontSize: '0.75rem', display: 'block', marginBottom: '6px' }}>
                            House Invite Code
                        </span>
                        <div className="house-code-display justify-between">
                            <code>{house.invite_code}</code>
                            <button
                                onClick={handleCopyCode}
                                className="share-btn"
                                title="Copy Invite Code"
                            >
                                {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                            </button>
                        </div>
                    </div>
                )}

                {/* Navigation Sidebar */}
                <nav style={{ flexGrow: 1 }}>
                    <ul className="nav-links">
                        {navItems.map(item => (
                            <li key={item.id}>
                                <button
                                    onClick={() => setActiveTab(item.id)}
                                    className={`nav-item w-full nav-button ${activeTab === item.id ? 'active' : ''}`}
                                    style={{ background: 'none', border: 'none', textAlign: 'left', font: 'inherit' }}
                                >
                                    {item.icon}
                                    <span>{item.label}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </nav>

                {/* Sidebar Footer User Details */}
                <div className="sidebar-footer">
                    <div className="user-badge font-sans">
                        <div className="user-avatar">
                            {profile?.name ? profile.name.charAt(0).toUpperCase() : 'U'}
                        </div>
                        <div className="user-info">
                            <span className="user-name">{profile?.name || 'Roommate'}</span>
                            <span className="house-name-text">{house?.name || 'No House'}</span>
                        </div>
                    </div>

                    <button onClick={onSignOut} className="btn btn-secondary w-full" style={{ padding: '8px 16px', fontSize: '0.85rem' }}>
                        <LogOut size={14} style={{ marginRight: '6px' }} /> Log Out
                    </button>
                </div>
            </aside>

            {/* Main Panel Content Pane */}
            <main className="content-pane">
                <div className="container" style={{ padding: 0 }}>
                    {children}
                </div>
            </main>
        </div>
    );
}
