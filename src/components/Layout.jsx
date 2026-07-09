import React, { useState } from 'react';
import { Home, Calendar, CheckSquare, Bell, LogOut, Copy, Check, Users } from 'lucide-react';

export default function Layout({
    profile,
    house,
    onSignOut,
    onSwitchHouse,
    activeTab,
    setActiveTab,
    notifications = [],
    onMarkNotificationRead,
    children
}) {
    const [copied, setCopied] = useState(false);
    const [showNotifDropdown, setShowNotifDropdown] = useState(false);

    const handleCopyCode = () => {
        if (!house?.invite_code) return;
        navigator.clipboard.writeText(house.invite_code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const navItems = [
        { id: 'dashboard', label: 'Dashboard', icon: <Home size={18} /> },
        { id: 'chores', label: 'Chores', icon: <CheckSquare size={18} /> },
        { id: 'calendar', label: 'Calendar', icon: <Calendar size={18} /> },
    ];

    const unreadCount = notifications.filter(n => !n.is_read).length;

    return (
        <div className="app-layout">
            {/* Background Glows */}
            <div className="glow-spot-1"></div>
            <div className="glow-spot-2"></div>

            {/* Sidebar Panel */}
            <aside className="sidebar">
                <div
                    onClick={() => setActiveTab('dashboard')}
                    className="sidebar-header"
                    style={{ position: 'relative', cursor: 'pointer' }}
                    title="Go to Dashboard"
                >
                    <div className="logo-icon purple-gradient" style={{ width: '38px', height: '38px', borderRadius: '8px' }}>
                        <Users size={20} />
                    </div>
                    <span className="sidebar-logo">{house?.name || 'Roomemates'}</span>

                    {/* Notification Bell */}
                    <div style={{ position: 'relative', marginLeft: 'auto' }}>
                        <button
                            onClick={() => setShowNotifDropdown(!showNotifDropdown)}
                            style={{
                                background: 'rgba(255, 255, 255, 0.05)',
                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                width: '34px',
                                height: '34px',
                                borderRadius: '50%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'var(--text-primary)',
                                cursor: 'pointer',
                                position: 'relative'
                            }}
                        >
                            <Bell size={16} />
                            {unreadCount > 0 && (
                                <span style={{
                                    position: 'absolute',
                                    top: '-2px',
                                    right: '-2px',
                                    background: 'var(--accent-purple)',
                                    color: 'white',
                                    fontSize: '0.65rem',
                                    width: '16px',
                                    height: '16px',
                                    borderRadius: '50%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontWeight: 'bold'
                                }}>
                                    {unreadCount}
                                </span>
                            )}
                        </button>

                        {showNotifDropdown && (
                            <div className="glass-card" style={{
                                position: 'absolute',
                                top: '42px',
                                left: '-200px',
                                width: '280px',
                                maxHeight: '350px',
                                overflowY: 'auto',
                                zIndex: 100,
                                padding: '12px',
                                backgroundColor: 'var(--bg-tertiary)',
                                boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.4)',
                                border: '1px solid rgba(255, 255, 255, 0.15)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '8px'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', paddingBottom: '6px', marginBottom: '4px' }}>
                                    <strong style={{ fontSize: '0.9rem' }}>Notifications</strong>
                                    {unreadCount > 0 && (
                                        <button
                                            onClick={() => notifications.forEach(n => !n.is_read && onMarkNotificationRead(n.id))}
                                            style={{ background: 'none', border: 'none', color: 'var(--accent-purple)', fontSize: '0.75rem', cursor: 'pointer' }}
                                        >
                                            Mark all read
                                        </button>
                                    )}
                                </div>
                                {notifications.length === 0 ? (
                                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>No notifications</p>
                                ) : (
                                    notifications.map(notif => (
                                        <div
                                            key={notif.id}
                                            onClick={() => !notif.is_read && onMarkNotificationRead(notif.id)}
                                            style={{
                                                padding: '8px 10px',
                                                borderRadius: '6px',
                                                background: notif.is_read ? 'rgba(255, 255, 255, 0.02)' : 'rgba(168, 85, 247, 0.08)',
                                                borderLeft: notif.is_read ? 'none' : '3px solid var(--accent-purple)',
                                                fontSize: '0.8rem',
                                                cursor: 'pointer',
                                                transition: 'background 0.2s',
                                                textAlign: 'left'
                                            }}
                                        >
                                            <p style={{ margin: '0 0 4px 0', lineHeight: 1.3 }}>{notif.message}</p>
                                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                                {new Date(notif.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}
                    </div>
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

                <div className="sidebar-footer">
                    <div
                        onClick={() => setActiveTab('dashboard')}
                        className="user-badge font-sans"
                        style={{ cursor: 'pointer', transition: 'opacity 0.2s' }}
                        title="Go to Dashboard"
                        onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
                        onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
                    >
                        <div className="user-avatar">
                            {profile?.name ? profile.name.charAt(0).toUpperCase() : 'U'}
                        </div>
                        <div className="user-info">
                            <span className="user-name">{profile?.name || 'Roommate'}</span>
                            <span className="house-name-text">{house?.name || 'No House'}</span>
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                            onClick={onSwitchHouse}
                            className="btn btn-secondary"
                            style={{ flexGrow: 1, padding: '8px 12px', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
                        >
                            Switch House
                        </button>
                        <button
                            onClick={onSignOut}
                            className="btn btn-secondary"
                            style={{ padding: '8px 12px', fontSize: '0.85rem' }}
                            title="Log Out"
                        >
                            <LogOut size={14} />
                        </button>
                    </div>
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
