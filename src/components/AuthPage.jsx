import React, { useState } from 'react';
import { supabase, setupSupabaseClient } from '../supabaseClient';
import { Shield, Mail, Lock, User, Database, ArrowRight, Activity, HelpCircle } from 'lucide-react';

export default function AuthPage({ onAuthSuccess }) {
    // If Supabase client isn't configured, show setup page first
    const [needsConfig, setNeedsConfig] = useState(!supabase);
    const [dbUrl, setDbUrl] = useState(localStorage.getItem('ROOMEMATES_SUPABASE_URL') || '');
    const [dbKey, setDbKey] = useState(localStorage.getItem('ROOMEMATES_SUPABASE_KEY') || '');
    const [configError, setConfigError] = useState('');

    // Authentication & Password Recovery Fields
    const [isSignUp, setIsSignUp] = useState(false);
    const [isForgotPassword, setIsForgotPassword] = useState(false);
    const [otpSent, setOtpSent] = useState(false);
    const [resetEmail, setResetEmail] = useState('');
    const [otpCode, setOtpCode] = useState('');
    const [newPassword, setNewPassword] = useState('');

    // Form Processing State
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [authError, setAuthError] = useState('');
    const [message, setMessage] = useState('');

    // Handle Supabase Credentials configuration
    const handleConfigSubmit = (e) => {
        e.preventDefault();
        setConfigError('');
        if (!dbUrl || !dbKey) {
            setConfigError('Please provide both URL and Anon Key.');
            return;
        }
        const success = setupSupabaseClient(dbUrl, dbKey);
        if (success) {
            setNeedsConfig(false);
        } else {
            setConfigError('Failed connection. Please check your credentials format.');
        }
    };

    // Handle login & sign up
    const handleAuthSubmit = async (e) => {
        e.preventDefault();
        setAuthError('');
        setMessage('');
        setLoading(true);

        if (!supabase) {
            setAuthError('Supabase is not configured.');
            setLoading(false);
            return;
        }

        try {
            if (isSignUp) {
                // Sign Up
                const { data, error } = await supabase.auth.signUp({
                    email,
                    password,
                    options: {
                        data: {
                            name: name || 'New Roommate',
                        },
                    },
                });
                if (error) throw error;

                if (data?.session) {
                    onAuthSuccess(data.session.user);
                } else {
                    setMessage('Check your email inbox for a confirmation link!');
                }
            } else {
                // Sign In
                const { data, error } = await supabase.auth.signInWithPassword({
                    email,
                    password,
                });
                if (error) throw error;
                if (data?.user) {
                    onAuthSuccess(data.user);
                }
            }
        } catch (err) {
            setAuthError(err.message || 'Authentication failed.');
        } finally {
            setLoading(false);
        }
    };

    // Handle Request Password Reset OTP
    const handleRequestOtp = async (e) => {
        e.preventDefault();
        setAuthError('');
        setMessage('');
        setLoading(true);

        if (!supabase) {
            setAuthError('Supabase is not configured.');
            setLoading(false);
            return;
        }

        try {
            const { error } = await supabase.auth.resetPasswordForEmail(resetEmail.trim(), {
                redirectTo: window.location.origin
            });
            if (error) throw error;
            setOtpSent(true);
            setMessage('A 6-digit password verification code has been sent to your email inbox.');
        } catch (err) {
            setAuthError(err.message || 'Request failed. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    // Handle Verify OTP code and Set New Password
    const handleVerifyOtpAndReset = async (e) => {
        e.preventDefault();
        setAuthError('');
        setMessage('');
        setLoading(true);

        try {
            // 1. Verify OTP token/code (logs in the user)
            const { data, error } = await supabase.auth.verifyOtp({
                email: resetEmail.trim(),
                token: otpCode.trim(),
                type: 'recovery'
            });

            if (error) throw error;

            // 2. Immediately set the new user password
            const { error: updateErr } = await supabase.auth.updateUser({
                password: newPassword
            });

            if (updateErr) throw updateErr;

            setMessage('Password updated successfully! Logging you in...');
            setTimeout(() => {
                onAuthSuccess(data.user || user);
            }, 1500);
        } catch (err) {
            setAuthError(err.message || 'Verification or password update failed.');
        } finally {
            setLoading(false);
        }
    };

    // Render credentials setup
    if (needsConfig) {
        return (
            <div className="auth-container">
                <div className="glow-spot-1"></div>
                <div className="glow-spot-2"></div>
                <div className="auth-card glass-card">
                    <div className="brand-header">
                        <div className="logo-icon purple-gradient">
                            <Database size={28} />
                        </div>
                        <h2>Database Connection</h2>
                        <p>Connect your Supabase instance to begin.</p>
                    </div>

                    <form onSubmit={handleConfigSubmit} className="auth-form">
                        {configError && <div className="feedback-alert error-alert">{configError}</div>}

                        <div className="form-group">
                            <label className="form-label" htmlFor="db-url">Supabase Project URL</label>
                            <div className="input-with-icon">
                                <input
                                    id="db-url"
                                    type="url"
                                    className="input-field"
                                    placeholder="https://your-project.supabase.co"
                                    value={dbUrl}
                                    onChange={(e) => setDbUrl(e.target.value)}
                                    required
                                />
                            </div>
                        </div>

                        <div className="form-group">
                            <label className="form-label" htmlFor="db-key">Supabase Anon Key</label>
                            <div className="input-with-icon">
                                <input
                                    id="db-key"
                                    type="password"
                                    className="input-field"
                                    placeholder="eyJhbGciOiJIUzI1NiIsIn..."
                                    value={dbKey}
                                    onChange={(e) => setDbKey(e.target.value)}
                                    required
                                />
                            </div>
                        </div>

                        <button type="submit" className="btn btn-primary w-full">
                            Connect Supabase <ArrowRight size={18} />
                        </button>

                        <p className="helper-text">
                            Credentials are saved securely in your local browser storage.
                        </p>
                    </form>
                </div>
            </div>
        );
    }

    // Render Password Recovery Screen (forgot password / verify OTP)
    if (isForgotPassword) {
        return (
            <div className="auth-container">
                <div className="glow-spot-1"></div>
                <div className="glow-spot-2"></div>
                <div className="auth-card glass-card">
                    <div className="brand-header">
                        <div className="logo-icon purple-gradient">
                            <HelpCircle size={28} />
                        </div>
                        <h1>Password Reset</h1>
                        <p>{otpSent ? 'Enter code and new password' : 'Enter email to receive recovery code (OTP)'}</p>
                    </div>

                    {authError && <div className="feedback-alert error-alert" style={{ marginBottom: '16px' }}>{authError}</div>}
                    {message && <div className="feedback-alert success-alert" style={{ marginBottom: '16px' }}>{message}</div>}

                    {!otpSent ? (
                        /* Part 1: Request OTP email */
                        <form onSubmit={handleRequestOtp} className="auth-form">
                            <div className="form-group">
                                <label className="form-label" htmlFor="reset-email">Email Address</label>
                                <div className="input-wrapper">
                                    <span className="icon-prefix"><Mail size={18} /></span>
                                    <input
                                        id="reset-email"
                                        type="email"
                                        className="input-field-icon"
                                        placeholder="email@example.com"
                                        value={resetEmail}
                                        onChange={(e) => setResetEmail(e.target.value)}
                                        required
                                    />
                                </div>
                            </div>

                            <button type="submit" disabled={loading} className="btn btn-primary w-full">
                                {loading ? (
                                    <Activity className="spinner-icon" size={18} />
                                ) : (
                                    <>Send OTP Verification <ArrowRight size={18} /></>
                                )}
                            </button>

                            <div className="toggle-mode">
                                <button
                                    type="button"
                                    className="toggle-btn"
                                    onClick={() => {
                                        setIsForgotPassword(false);
                                        setAuthError('');
                                        setMessage('');
                                    }}
                                >
                                    Back to Log In
                                </button>
                            </div>
                        </form>
                    ) : (
                        /* Part 2: Verify Code and Reset Password */
                        <form onSubmit={handleVerifyOtpAndReset} className="auth-form">
                            <p className="helper-text text-left" style={{ margin: '0 0 10px 0', fontSize: '0.85rem' }}>
                                Verify for your email: <strong>{resetEmail}</strong>
                            </p>

                            <div className="form-group">
                                <label className="form-label" htmlFor="otp-code">Verification Code (OTP)</label>
                                <div className="input-wrapper">
                                    <span className="icon-prefix"><Shield size={18} /></span>
                                    <input
                                        id="otp-code"
                                        type="text"
                                        className="input-field-icon"
                                        placeholder="e.g. 123456"
                                        value={otpCode}
                                        onChange={(e) => setOtpCode(e.target.value)}
                                        maxLength={6}
                                        required
                                    />
                                </div>
                            </div>

                            <div className="form-group">
                                <label className="form-label" htmlFor="new-password">Choose New Password</label>
                                <div className="input-wrapper">
                                    <span className="icon-prefix"><Lock size={18} /></span>
                                    <input
                                        id="new-password"
                                        type="password"
                                        className="input-field-icon"
                                        placeholder="••••••••"
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        required
                                    />
                                </div>
                            </div>

                            <button type="submit" disabled={loading} className="btn btn-primary w-full">
                                {loading ? (
                                    <Activity className="spinner-icon" size={18} />
                                ) : (
                                    <>Verify & Change Password <ArrowRight size={18} /></>
                                )}
                            </button>

                            <div className="toggle-mode" style={{ flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
                                <button
                                    type="button"
                                    className="toggle-btn"
                                    onClick={() => {
                                        setOtpSent(false);
                                        setAuthError('');
                                        setMessage('');
                                    }}
                                >
                                    Change Email Address
                                </button>
                                <button
                                    type="button"
                                    className="toggle-btn"
                                    style={{ color: 'var(--text-muted)' }}
                                    onClick={() => {
                                        setIsForgotPassword(false);
                                        setIsForgotPassword(false);
                                        setOtpSent(false);
                                        setAuthError('');
                                        setMessage('');
                                    }}
                                >
                                    Back to Log In
                                </button>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        );
    }

    // Render authentication UI (Sign In / Sign Up)
    return (
        <div className="auth-container">
            <div className="glow-spot-1"></div>
            <div className="glow-spot-2"></div>
            <div className="auth-card glass-card">
                <div className="brand-header">
                    <div className="logo-icon purple-gradient">
                        <Shield size={28} />
                    </div>
                    <h1>Roomemates</h1>
                    <p>{isSignUp ? 'Create your account to join a house' : 'Welcome back, sign in to your roommate hub'}</p>
                </div>

                <form onSubmit={handleAuthSubmit} className="auth-form">
                    {authError && <div className="feedback-alert error-alert">{authError}</div>}
                    {message && <div className="feedback-alert success-alert">{message}</div>}

                    {isSignUp && (
                        <div className="form-group">
                            <label className="form-label" htmlFor="auth-name">Display Name</label>
                            <div className="input-wrapper">
                                <span className="icon-prefix"><User size={18} /></span>
                                <input
                                    id="auth-name"
                                    type="text"
                                    className="input-field-icon"
                                    placeholder="Alex Mercer"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    required={isSignUp}
                                />
                            </div>
                        </div>
                    )}

                    <div className="form-group">
                        <label className="form-label" htmlFor="auth-email">Email Address</label>
                        <div className="input-wrapper">
                            <span className="icon-prefix"><Mail size={18} /></span>
                            <input
                                id="auth-email"
                                type="email"
                                className="input-field-icon"
                                placeholder="email@example.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <div className="form-group">
                        <div className="flex justify-between items-center" style={{ margin: 0, padding: 0 }}>
                            <label className="form-label" htmlFor="auth-password">Password</label>
                            {!isSignUp && (
                                <button
                                    type="button"
                                    className="toggle-btn"
                                    style={{ fontSize: '0.8rem', fontWeight: '500', color: 'var(--text-secondary)' }}
                                    onClick={() => {
                                        setIsForgotPassword(true);
                                        setResetEmail(email); // Prefill requested email if filled
                                        setAuthError('');
                                        setMessage('');
                                    }}
                                >
                                    Forgot Password?
                                </button>
                            )}
                        </div>
                        <div className="input-wrapper">
                            <span className="icon-prefix"><Lock size={18} /></span>
                            <input
                                id="auth-password"
                                type="password"
                                className="input-field-icon"
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <button type="submit" disabled={loading} className="btn btn-primary w-full">
                        {loading ? (
                            <>
                                <Activity className="spinner-icon" size={18} /> Processing...
                            </>
                        ) : isSignUp ? (
                            <>Create Account <ArrowRight size={18} /></>
                        ) : (
                            <>Sign In <ArrowRight size={18} /></>
                        )}
                    </button>

                    <div className="toggle-mode">
                        <span>{isSignUp ? 'Already have an account?' : "Don't have an account?"}</span>
                        <button
                            type="button"
                            className="toggle-btn"
                            onClick={() => {
                                setIsSignUp(!isSignUp);
                                setAuthError('');
                                setMessage('');
                            }}
                        >
                            {isSignUp ? 'Sign In' : 'Sign Up'}
                        </button>
                    </div>

                    <button
                        type="button"
                        className="btn-link-config"
                        onClick={() => setNeedsConfig(true)}
                    >
                        Change Database Configuration
                    </button>
                </form>
            </div>
        </div>
    );
}
