import React, { useState } from 'react';
import { supabase } from '../supabaseClient';
import { Home, Users, PlusCircle, ArrowRight, LogOut, Check } from 'lucide-react';

export default function HouseSetup({ user, onHouseSetupSuccess, onSignOut }) {
    const [houseName, setHouseName] = useState('');
    const [inviteCode, setInviteCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [successMsg, setSuccessMsg] = useState('');

    // Helper to generate a unique 6-character uppercase alphanumeric code
    const generateInviteCode = () => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    };

    // Create a new household
    const handleCreateHouse = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        if (!houseName.trim()) {
            setError('Please provide a name for your household.');
            setLoading(false);
            return;
        }

        try {
            const code = generateInviteCode();

            // 1. Insert house
            const { data: newHouse, error: houseErr } = await supabase
                .from('houses')
                .insert([{ name: houseName, invite_code: code }])
                .select()
                .single();

            if (houseErr) throw houseErr;

            // 2. Assign current user profile to this house_id
            const { error: profileErr } = await supabase
                .from('profiles')
                .update({ house_id: newHouse.id })
                .eq('id', user.id);

            if (profileErr) throw profileErr;

            setSuccessMsg(`House "${houseName}" created successfully! Code: ${code}`);
            setTimeout(() => {
                onHouseSetupSuccess(newHouse.id);
            }, 1500);

        } catch (err) {
            setError(err.message || 'Error occurred while creating house.');
        } finally {
            setLoading(false);
        }
    };

    // Join an existing household via invite code
    const handleJoinHouse = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        const cleanCode = inviteCode.trim().toUpperCase();
        if (!cleanCode) {
            setError('Please input a valid 6-digit invite code.');
            setLoading(false);
            return;
        }

        try {
            // 1. Find house with invite code
            const { data: targetHouse, error: searchErr } = await supabase
                .from('houses')
                .select()
                .eq('invite_code', cleanCode)
                .maybeSingle();

            if (searchErr) throw searchErr;
            if (!targetHouse) {
                setError('Household not found. Please verify the code.');
                setLoading(false);
                return;
            }

            // 2. Assign current user's profile to target house_id
            const { error: profileErr } = await supabase
                .from('profiles')
                .update({ house_id: targetHouse.id })
                .eq('id', user.id);

            if (profileErr) throw profileErr;

            setSuccessMsg(`Successfully joined "${targetHouse.name}"!`);
            setTimeout(() => {
                onHouseSetupSuccess(targetHouse.id);
            }, 1500);

        } catch (err) {
            setError(err.message || 'Error occurred while joining house.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="setup-container">
            <div className="glow-spot-1"></div>
            <div className="glow-spot-2"></div>

            <div className="setup-wrapper">
                <header className="setup-header">
                    <h1>Roomemates Setup</h1>
                    <p>Get started by creating a new household or joining an existing one.</p>
                </header>

                {error && <div className="feedback-alert error-alert max-w-card">{error}</div>}
                {successMsg && (
                    <div className="feedback-alert success-alert max-w-card flex items-center justify-center gap-2">
                        <Check size={18} /> {successMsg}
                    </div>
                )}

                <div className="grid-2 max-w-card">
                    {/* Card 1: Create a House */}
                    <div className="glass-card glass-card-hover setup-card">
                        <div className="setup-card-title">
                            <PlusCircle className="text-purple" size={32} />
                            <h2>Create a House</h2>
                        </div>
                        <p className="setup-card-desc">
                            Start a fresh group, generate a shared invite link, and coordinate bills, chores, and groceries together!
                        </p>
                        <form onSubmit={handleCreateHouse} className="setup-form">
                            <div className="form-group">
                                <label className="form-label" htmlFor="house-name">Household Name</label>
                                <input
                                    id="house-name"
                                    type="text"
                                    className="input-field"
                                    placeholder="e.g. Sunset Villa, Apt 4B"
                                    value={houseName}
                                    onChange={(e) => setHouseName(e.target.value)}
                                    disabled={loading}
                                />
                            </div>
                            <button type="submit" className="btn btn-primary w-full" disabled={loading}>
                                Create House <ArrowRight size={18} />
                            </button>
                        </form>
                    </div>

                    {/* Card 2: Join a House */}
                    <div className="glass-card glass-card-hover setup-card">
                        <div className="setup-card-title">
                            <Users className="text-cyan" size={32} />
                            <h2>Join Local House</h2>
                        </div>
                        <p className="setup-card-desc">
                            Have your roommates already started a house? Ask them for their 6-digit invite code and paste it below.
                        </p>
                        <form onSubmit={handleJoinHouse} className="setup-form">
                            <div className="form-group">
                                <label className="form-label" htmlFor="invite-code">Invite Code</label>
                                <input
                                    id="invite-code"
                                    type="text"
                                    className="input-field invite-input"
                                    placeholder="e.g. ABC123"
                                    maxLength={6}
                                    value={inviteCode}
                                    onChange={(e) => setInviteCode(e.target.value)}
                                    disabled={loading}
                                />
                            </div>
                            <button type="submit" className="btn btn-accent w-full" disabled={loading}>
                                Join House <ArrowRight size={18} />
                            </button>
                        </form>
                    </div>
                </div>

                <div className="logout-wrapper">
                    <button onClick={onSignOut} className="btn btn-secondary">
                        <LogOut size={16} /> Log Out
                    </button>
                </div>
            </div>
        </div>
    );
}
